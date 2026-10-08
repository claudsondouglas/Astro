import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import Stats from "three/addons/libs/stats.module.js";

const renderer = new THREE.WebGLRenderer(); // sem antialias: o composer desenha em render targets, o canvas só recebe um quad
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // HiDPI acima de 2x custa muito e quase não se vê
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // sem filtro: borda da sombra dura
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x1e1b18);
scene.background = BG;

// Câmera ortográfica em ângulo isométrico
const VIEW = 12;
const camera = new THREE.OrthographicCamera();
camera.position.set(20, 20, 20);
camera.lookAt(0, 0, 0);
// Q/E giram a câmera 90° em volta do ponto no centro da tela; off = câmera - ponto do chão olhado
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const off = new THREE.Vector3(20, 20, 20);
let yaw = 0, yawTarget = 0;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(8, 15, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); // mais resolução, senão a borda dura fica serrilhada
sun.shadow.normalBias = 0.05; // sem isso a face sombreia a si mesma (shadow acne: listras e triângulos nas paredes)
// área da sombra: o padrão (±5) deixa as quinas da sala de fora, e fora dela tudo fica aceso
const sc = sun.shadow.camera;
sc.left = sc.bottom = -10;
sc.right = sc.top = 10;
sc.updateProjectionMatrix();
scene.add(sun, sun.target); // target na cena pra o sol seguir a sala atual

// Toon: luz em 3 faixas chapadas (sombra / meio / luz) em vez de degradê
const gradientMap = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;
const toon = (p: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap, ...p });

const materials = new Map<number, THREE.MeshToonMaterial>(); // um material por cor, compartilhado
const box = (w: number, h: number, d: number, color: number) => {
  if (!materials.has(color)) materials.set(color, toon({ color }));
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.get(color));
  m.castShadow = m.receiveShadow = true;
  return m;
};

// Mundo: chão de grama com um tabuleiro de SLOTS×SLOTS vagas do tamanho de uma sala, separadas por um corredor de grama
const ROOM = 10, LANE = 4; // corredor entre vagas: não recebe sala
const SLOTS = 5, PITCH = ROOM + LANE; // máximo de SLOTS² workspaces
const BOARD = SLOTS * ROOM + (SLOTS - 1) * LANE; // tabuleiro centrado na origem
const WORLD = 11 * PITCH; // 11×11 células: as 5×5 do centro usáveis, 3 de cenário em cada lado
const GRASS_Y = -0.2; // piso das salas fica um degrau acima da grama
const R = 0.65; // meia largura da cabeça (parte mais larga), pra não atravessar parede
const FLOOR = new THREE.Color(0xd8c8a8);

// Grama: textura de tufos (2×2 unidades) repetida no chão todo
const TILE = 64;
const tile = document.createElement("canvas");
tile.width = tile.height = TILE;
const g2d = tile.getContext("2d")!;
g2d.fillStyle = "#7f9a5e";
g2d.fillRect(0, 0, TILE, TILE);
g2d.fillStyle = "#77915a";
for (let n = 0; n < 12; n++) g2d.fillRect(Math.random() * TILE | 0, Math.random() * TILE | 0, 2, 5);
const grassTex = new THREE.CanvasTexture(tile);
grassTex.colorSpace = THREE.SRGBColorSpace;
grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
grassTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
grassTex.repeat.set(WORLD / 2, WORLD / 2);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), toon({ map: grassTex }));
grass.rotation.x = -Math.PI / 2;
grass.position.y = GRASS_Y;
grass.receiveShadow = true;
scene.add(grass);

// Cenário: vagas falsas (só contorno fraco) repetidas pela grama toda, alinhadas com o tabuleiro; não aceitam sala
const PX = 32; // pixels por unidade: a linha de 2px fica fina na tela
const deco = document.createElement("canvas");
deco.width = deco.height = PITCH * PX;
const d2d = deco.getContext("2d")!;
d2d.strokeStyle = "#00000014";
d2d.lineWidth = 2;
d2d.strokeRect(LANE / 2 * PX + 1, LANE / 2 * PX + 1, ROOM * PX - 2, ROOM * PX - 2); // vaga centrada na célula
const decoTex = new THREE.CanvasTexture(deco);
decoTex.colorSpace = THREE.SRGBColorSpace;
decoTex.anisotropy = grassTex.anisotropy;
decoTex.wrapS = decoTex.wrapT = THREE.RepeatWrapping;
decoTex.repeat.set(WORLD / PITCH, WORLD / PITCH);
decoTex.offset.setScalar(0.5 - (WORLD / 2 / PITCH) % 1); // centro de uma célula cai na origem, igual às vagas
const decoMesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), toon({ map: decoTex, transparent: true }));
decoMesh.rotation.x = -Math.PI / 2;
decoMesh.position.y = GRASS_Y + 0.005;
decoMesh.receiveShadow = true;
scene.add(decoMesh);

// Tabuleiro: só o contorno de cada vaga, numa camada transparente logo acima da grama
const board = document.createElement("canvas");
board.width = board.height = BOARD * PX;
const b2d = board.getContext("2d")!;
b2d.fillStyle = "#ffffff0a";
b2d.strokeStyle = "#00000026";
b2d.lineWidth = 2;
for (let sx = 0; sx < SLOTS; sx++) for (let sz = 0; sz < SLOTS; sz++) {
  b2d.fillRect(sx * PITCH * PX, sz * PITCH * PX, ROOM * PX, ROOM * PX);
  b2d.strokeRect(sx * PITCH * PX + 1, sz * PITCH * PX + 1, ROOM * PX - 2, ROOM * PX - 2);
}
const boardTex = new THREE.CanvasTexture(board);
boardTex.colorSpace = THREE.SRGBColorSpace;
boardTex.anisotropy = grassTex.anisotropy;
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD, BOARD), toon({ map: boardTex, transparent: true }));
boardMesh.rotation.x = -Math.PI / 2; // topo do canvas fica em -z, igual à vaga sz = 0
boardMesh.position.y = GRASS_Y + 0.01;
boardMesh.receiveShadow = true;
scene.add(boardMesh);

// Sala: um ou mais retângulos de piso (x/z inteiros a partir do canto da vaga) + paredes em todas as bordas do contorno,
// com uma porta na frente (+z)
const rooms: THREE.Group[] = [];
const roomWalls: ReturnType<typeof wallsOf>[] = []; // paredes de cada sala (locais), refeitas no addRoom
const slotCenter = (s: number) => (s - (SLOTS - 1) / 2) * PITCH;
const ROOM_MIN = 4; // sala de um retângulo só não fica menor que isso
type Rect = { x: number; z: number; w: number; d: number };
const corner = (ws: Workspace) => new THREE.Vector3(slotCenter(ws.sx) - ROOM / 2, 0, slotCenter(ws.sz) - ROOM / 2);
// Centro do primeiro retângulo da sala i (sol, posição salva do agent)
const roomPos = (i: number) => {
  const r = workspaces[i].parts[0];
  return corner(workspaces[i]).add({ x: r.x + r.w / 2, y: 0, z: r.z + r.d / 2 });
};
let editing = -1; // sala no modo de edição, ou -1
const key = (x: number, z: number) => `${x},${z}`;
// Células 1×1 cobertas pelo piso
function cellsIn(parts: Rect[]) {
  const cells = new Set<string>();
  for (const r of parts) for (let x = r.x; x < r.x + r.w; x++) for (let z = r.z; z < r.z + r.d; z++) cells.add(key(x, z));
  return cells;
}
// Paredes (0.2 de espessura, pra fora) em toda borda do contorno, emendando células vizinhas numa parede só;
// as de +x/+z ganham userData.front. A +z mais comprida tem uma porta de DOOR no meio
const DOOR = 2;
function wallsOf(parts: Rect[], cut = true): (Rect & { front: boolean })[] {
  const cells = cellsIn(parts), walls: (Rect & { front: boolean })[] = [], T = 0.2;
  // borda da célula (x, z) virada pro lado -(dx, dz) sem piso do outro lado
  const open = (x: number, z: number, dx: number, dz: number) => cells.has(key(x, z)) && !cells.has(key(x - dx, z - dz));
  let door: { wall: Rect & { front: boolean }; x: number; n: number } | null = null;
  for (const c of cells) {
    const [x, z] = c.split(",").map(Number);
    for (const s of [1, -1]) {
      const front = s < 0, out = front ? 1 : -T; // +x/+z: parede começa na borda de fora da célula
      if (open(x, z, s, 0) && !open(x, z - 1, s, 0)) { // começo de uma parede em x
        let n = 1;
        while (open(x, z + n, s, 0)) n++;
        walls.push({ x: x + out, z, w: T, d: n, front });
      }
      if (open(x, z, 0, s) && !open(x - 1, z, 0, s)) { // começo de uma parede em z
        let n = 1;
        while (open(x + n, z, 0, s)) n++;
        // quina de fora (ponta sem piso do lado): estica T pra cobrir o quadrado que as duas paredes deixariam vazio
        const lo = open(x, z, 1, 0) ? T : 0, hi = open(x + n - 1, z, -1, 0) ? T : 0;
        const w = { x: x - lo, z: z + out, w: n + lo + hi, d: T, front };
        walls.push(w);
        if (front && n >= DOOR + 1 && (!door || n > door.n)) door = { wall: w, x, n };
      }
    }
  }
  if (door && cut) { // corta a porta no meio (contando em células, sem as pontas esticadas), deixando os dois pedaços
    const { wall: d, x, n } = door, a = x + Math.floor((n - DOOR) / 2);
    walls.splice(walls.indexOf(d), 1, { ...d, w: a - d.x }, { ...d, x: a + DOOR, w: d.x + d.w - a - DOOR });
  }
  return walls.filter((r) => r.w > 0 && r.d > 0);
}
// Vagas (a partir da do canto) cobertas pelo trecho [a, a + len] de um eixo: entrar no corredor já pega a vaga seguinte
function cellsOf(a: number, len: number) {
  const r: number[] = [];
  for (let s = Math.floor(a / PITCH); s <= Math.ceil((a + len - ROOM) / PITCH); s++) r.push(s);
  return r;
}
const slotsOf = (ws: Workspace) => ws.parts.filter((r) => r.w > 0 && r.d > 0).flatMap((r) =>
  cellsOf(r.x, r.w).flatMap((x) => cellsOf(r.z, r.d).map((z) => [ws.sx + x, ws.sz + z])));
// Vaga ocupada por alguma sala (salas grandes cobrem várias), ignorando a sala `except`
const taken = (sx: number, sz: number, except = -1) =>
  workspaces.some((w, i) => i !== except && slotsOf(w).some(([x, z]) => x === sx && z === sz));
// A sala i caberia como `ws`: todas as vagas cobertas no tabuleiro e livres
const fits = (i: number, ws: Workspace) =>
  slotsOf(ws).every(([x, z]) => Math.min(x, z) >= 0 && Math.max(x, z) < SLOTS && !taken(x, z, i));
// Vaga sob o ponto, ou null no corredor/fora do tabuleiro
function slotAt(x: number, z: number): [number, number] | null {
  const sx = Math.round(x / PITCH + (SLOTS - 1) / 2), sz = Math.round(z / PITCH + (SLOTS - 1) / 2);
  if (Math.min(sx, sz) < 0 || Math.max(sx, sz) >= SLOTS) return null;
  if (Math.max(Math.abs(x - slotCenter(sx)), Math.abs(z - slotCenter(sz))) > ROOM / 2) return null;
  return [sx, sz];
}
// Vaga livre mais perto do ponto, ou null com o tabuleiro cheio
function freeSlot(x: number, z: number): [number, number] | null {
  let best: [number, number] | null = null, d = Infinity;
  for (let sx = 0; sx < SLOTS; sx++) for (let sz = 0; sz < SLOTS; sz++) {
    const dd = Math.hypot(slotCenter(sx) - x, slotCenter(sz) - z);
    if (dd < d && !taken(sx, sz)) [best, d] = [[sx, sz], dd];
  }
  return best;
}
function placeRoom(i: number) {
  rooms[i].position.copy(corner(workspaces[i]));
  rooms[i].updateMatrix();
  wallsVer++;
  if (i === editing) placeHandles();
}
function addRoom(i: number) {
  if (rooms[i]) { // refazendo (mudou de tamanho): solta a antiga
    scene.remove(rooms[i]);
    rooms[i].traverse((m) => (m as THREE.Mesh).geometry?.dispose());
  }
  const room = new THREE.Group(), ws = workspaces[i];
  const tone = FLOOR.clone().offsetHSL(i * 0.13, 0, 0).getHex(); // cada sala com um tom
  // piso também embaixo das paredes e da porta (paredes sem o corte da porta)
  for (const r of [...ws.parts, ...wallsOf(ws.parts, false)]) if (r.w > 0 && r.d > 0) {
    const floor = box(r.w, 0.2, r.d, tone);
    floor.position.set(r.x + r.w / 2, -0.1, r.z + r.d / 2);
    floor.castShadow = false; // nada embaixo do piso
    room.add(floor);
  }
  roomWalls[i] = wallsOf(ws.parts);
  for (const r of roomWalls[i]) {
    const wall = box(r.w, 4, r.d, r.w < r.d ? 0xb9a88a : 0xc9b898); // parede -x um tom mais escura que a -z
    wall.position.set(r.x + r.w / 2, 2, r.z + r.d / 2);
    wall.userData.wall = true;
    const n = r.front ? 1 : -1; // normal de fora da parede: lado que ela tapa pra câmera
    wall.userData.normal = r.w < r.d ? new THREE.Vector3(n, 0, 0) : new THREE.Vector3(0, 0, n);
    room.add(wall);
  }
  room.traverse((m) => {
    m.updateMatrix();
    m.matrixAutoUpdate = false; // estáticos: não recalcula matriz todo frame
  });
  scene.add(room);
  rooms[i] = room;
  placeRoom(i);
}
// Dentro da grama e fora das paredes (engordadas pelo raio do agent)
const canWalk = (x: number, z: number) =>
  Math.max(Math.abs(x), Math.abs(z)) <= WORLD / 2 - R &&
  workspaces.every((ws, i) => {
    const c = corner(ws);
    return roomWalls[i].every((r) => !(x > c.x + r.x - R && x < c.x + r.x + r.w + R && z > c.z + r.z - R && z < c.z + r.z + r.d + R));
  });
// Sala cujo piso contém o ponto, ou -1 na grama
const roomAt = (x: number, z: number) => workspaces.findIndex((ws) => {
  const c = corner(ws);
  return ws.parts.some((r) => x >= c.x + r.x && x <= c.x + r.x + r.w && z >= c.z + r.z && z <= c.z + r.z + r.d);
});

// Agent: cabeça com olhos, torso, 2 pernas, 2 braços (tudo laranja)
const ORANGE = 0xd97757;
const agent = new THREE.Group();
const body = new THREE.Group(); // torso + cabeça + braços, origem no centro do torso
body.position.y = 0.95;
agent.add(body);
const torso = box(0.9, 0.7, 0.6, ORANGE);
const head = box(1.2, 0.7, 0.9, ORANGE);
head.position.y = 0.7; // logo acima do torso
body.add(torso, head);
const eyes: THREE.Mesh[] = [];
for (const x of [-0.25, 0.25]) {
  const eye = box(0.12, 0.22, 0.05, 0x111111);
  eye.position.set(x, 0.05, 0.46);
  const glint = box(0.04, 0.06, 0.02, 0xffffff); // brilho dá vida ao olho
  glint.position.set(0.025, 0.06, 0.03);
  eye.add(glint);
  head.add(eye); // olhos acompanham a cabeça
  eyes.push(eye);
}
// Pernas e braços ficam dentro de um Group no quadril/ombro, pra girar a partir da junta
const legs: THREE.Group[] = [], arms: THREE.Group[] = [];
for (const x of [-0.25, 0.25]) {
  const hip = new THREE.Group();
  hip.position.set(x, 0.6, 0);
  const leg = box(0.24, 0.6, 0.25, ORANGE);
  leg.position.y = -0.3;
  hip.add(leg);
  agent.add(hip);
  legs.push(hip);
}
for (const x of [-0.56, 0.56]) { // um vão do torso pra silhueta do braço aparecer
  const shoulder = new THREE.Group();
  shoulder.position.set(x, 0.3, 0); // topo do torso
  const arm = box(0.16, 0.5, 0.2, ORANGE);
  arm.position.y = -0.25;
  shoulder.add(arm);
  body.add(shoulder); // braços acompanham o corpo
  arms.push(shoulder);
}
agent.rotation.y = Math.PI / 4; // virado pra câmera
scene.add(agent);
// Parede na frente do agent fica meio transparente: raio do agent rumo à câmera (off) nos pés, torso e cabeça
const faded = new Map<THREE.Material, THREE.Material>(); // versão transparente de cada material de parede
const fadeOf = (m: THREE.Material) =>
  faded.get(m) ?? faded.set(m, Object.assign(m.clone(), { transparent: true, opacity: 0.35 })).get(m)!;
const seeRay = new THREE.Raycaster(), toCam = new THREE.Vector3(1, 1, 1).normalize(), eye = new THREE.Vector3();
const front = new Set<THREE.Object3D>(); // paredes transparentes agora: sem sombra e fora do passe de contorno
let wallsVer = 0, wallsAt = -1, walls: THREE.Mesh[] = []; // wallsVer muda quando alguma sala é refeita/movida/apagada
const floorFront = new Set<THREE.Object3D>(); // paredes que tapam o piso da sala atual: só refaz se sala/câmera mudar
let floorKey = "";
function fadeWalls() {
  if (wallsAt !== wallsVer) {
    walls = rooms.flatMap((r) => r.children.filter((m) => m.userData.wall) as THREE.Mesh[]);
    wallsAt = wallsVer;
  }
  front.clear();
  toCam.copy(off).normalize();
  if (editing >= 0) for (const w of walls) if (w.parent === rooms[editing]) front.add(w); // editando: dá pra ver e puxar o lado das paredes
  for (const y of [0.2, 1, 1.8]) {
    seeRay.set(eye.copy(agent.position).setY(agent.position.y + y), toCam);
    for (const h of seeRay.intersectObjects(walls, false)) front.add(h.object);
  }
  // Dentro de uma sala: também some o que tapa qualquer ponto do piso dela (grade de 1 em 1)
  const i = roomAt(agent.position.x, agent.position.z);
  if (i >= 0) {
    const c = corner(workspaces[i]);
    for (const w of walls) if (w.parent === rooms[i] && w.userData.normal.dot(off) > 0) front.add(w); // frente da própria sala
    const k = `${wallsVer},${i},${off.x},${off.z}`;
    if (k !== floorKey) {
      floorKey = k;
      floorFront.clear();
      const others = walls.filter((w) => w.parent !== rooms[i]); // raio da borda do piso nasce colado na própria parede
      for (const r of workspaces[i].parts) for (let x = r.x; x <= r.x + r.w; x++) for (let z = r.z; z <= r.z + r.d; z++) {
        seeRay.set(eye.set(c.x + x, 0.01, c.z + z), toCam);
        for (const h of seeRay.intersectObjects(others, false)) floorFront.add(h.object);
      }
    }
    for (const w of floorFront) front.add(w);
  }
  for (const w of walls) {
    w.userData.solid ??= w.material;
    w.material = front.has(w) ? fadeOf(w.userData.solid) : w.userData.solid;
    w.castShadow = !front.has(w); // senão a sombra dela no chão atrás aparece através
  }
}

// Outline: renderiza normais + profundidade num target à parte e pinta de preto onde elas mudam bruscamente
const normalTarget = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
const normalMat = new THREE.MeshNormalMaterial();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const outline = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2() },
    depthRange: { value: 1 }, // far - near (ortográfica: profundidade já é linear)
    width: { value: 2 }, // espessura da borda em pixels, segue o zoom
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform vec2 resolution;
    uniform float depthRange, width;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d0 = texture2D(tDepth, vUv).r;
      vec3 n0 = texture2D(tNormal, vUv).rgb;
      float ne = 0.0;
      vec2 px = width / resolution; // traço grosso de cartoon
      vec2 offs[4] = vec2[](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
      float d[4];
      for (int i = 0; i < 4; i++) {
        d[i] = texture2D(tDepth, vUv + offs[i]).r;
        ne += distance(texture2D(tNormal, vUv + offs[i]).rgb, n0);
      }
      // diferença segunda: zero em plano inclinado (chão de longe), só degrau real vira borda
      float de = abs(d[0] + d[1] - 2.0 * d0) + abs(d[2] + d[3] - 2.0 * d0);
      float edge = max(step(0.15, de * depthRange), step(0.5, ne)); // limiares: unidades de mundo / diferença de normal
      gl_FragColor = vec4(mix(color.rgb, vec3(0.0), edge), color.a);
    }`,
});
// ShaderPass clona os uniforms e zera texturas de render target; liga depois
outline.uniforms.tNormal.value = normalTarget.texture;
outline.uniforms.tDepth.value = normalTarget.depthTexture;
composer.addPass(outline);
composer.addPass(new OutputPass()); // conversão pra sRGB, que o render direto fazia sozinho

function render() {
  // passe de normais: sem fundo e sem refazer o shadow map
  scene.overrideMaterial = normalMat;
  scene.background = null;
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(normalTarget);
  for (const w of front) w.visible = false;
  renderer.render(scene, camera);
  for (const w of front) w.visible = true;
  renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = true;
  scene.background = BG;
  scene.overrideMaterial = null;
  composer.render();
}

function resize() {
  const a = innerWidth / innerHeight;
  camera.left = -VIEW * a / 2;
  camera.right = VIEW * a / 2;
  camera.top = VIEW / 2;
  camera.bottom = -VIEW / 2;
  camera.near = 0.1;
  camera.far = 100;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  const size = renderer.getDrawingBufferSize(outline.uniforms.resolution.value);
  normalTarget.setSize(size.x, size.y);
  outline.uniforms.depthRange.value = camera.far - camera.near;
}
addEventListener("resize", resize);
resize();

// Zoom na roda do mouse, limitado a um pouco pra perto e pra longe
const ZOOM_MIN = 0.4, ZOOM_MAX = 1.6;
const ZOOM_DEFAULT = 0.7; // roda do mouse afasta até ZOOM_MIN
function setZoom(z: number) {
  camera.zoom = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
  camera.updateProjectionMatrix();
  outline.uniforms.width.value = 2 * camera.zoom / ZOOM_DEFAULT; // borda encolhe junto com o mundo ao afastar
}
setZoom(ZOOM_DEFAULT);
addEventListener("wheel", (e) => setZoom(camera.zoom - e.deltaY * 0.001), { passive: true });

// Mantém a área visível dentro da grama (pan/zoom/seguir não mostram o vazio).
// A câmera olha na direção -off: o ponto do chão no centro da tela é p - off (com p.y = 20).
// A tela vira no chão um retângulo girado: meia largura w e meia altura h·√3 (inclinação do isométrico).
function clampCamera() {
  const h = VIEW / camera.zoom / 2, w = h * innerWidth / innerHeight;
  const fx = Math.abs(off.x) / Math.hypot(off.x, off.z), fz = Math.abs(off.z) / Math.hypot(off.x, off.z);
  const mx = Math.max(WORLD / 2 - (w * fz + h * Math.sqrt(3) * fx), 0); // até onde o centro pode ir em x/z
  const mz = Math.max(WORLD / 2 - (w * fx + h * Math.sqrt(3) * fz), 0);
  const p = camera.position;
  p.addScaledVector(off, (20 - p.y) / off.y); // pan no plano da tela baixa a câmera até o chão passar do near; desliza na direção da vista de volta pra altura 20
  p.x = THREE.MathUtils.clamp(p.x - off.x, -mx, mx) + off.x;
  p.z = THREE.MathUtils.clamp(p.z - off.z, -mz, mz) + off.z;
  camera.lookAt(p.x - off.x, 0, p.z - off.z);
}
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (e.code === "KeyQ") yawTarget -= Math.PI / 2;
  if (e.code === "KeyE") yawTarget += Math.PI / 2;
});

// WASD move o agent relativo à tela (W = pra cima na tela, que no isométrico é -x -z)
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if (!(e.target instanceof HTMLInputElement)) keys.add(e.code); // digitar o nome do workspace não anda
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear()); // evita tecla "presa" ao trocar de janela
const SPEED = 4; // unidades por segundo
const camShift = new THREE.Vector3(); // deslocamento da câmera ainda a percorrer atrás do agent
const followed = new THREE.Vector3(); // última posição do agent que a câmera já acompanhou
const move = new THREE.Vector3();
let last = 0;
let walk = 0, stride = 0; // fase do passo e intensidade (0 parado, 1 andando)

// FPS no canto da tela, só no `vite dev` (clique alterna FPS/ms/MB)
const stats = import.meta.env.DEV ? new Stats() : null;
if (stats) document.body.appendChild(stats.dom);

renderer.setAnimationLoop((t) => {
  stats?.update();
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;
  const fwd = +keys.has("KeyW") - +keys.has("KeyS");
  const side = +keys.has("KeyD") - +keys.has("KeyA");
  move.set(side - fwd, 0, -side - fwd).applyAxisAngle(Y_AXIS, yaw); // relativo à câmera girada
  const moving = move.lengthSq() > 0;
  stride = THREE.MathUtils.clamp(stride + (moving ? dt : -dt) * 6, 0, 1);
  if (moving) {
    walk += dt * 12;
    move.normalize().multiplyScalar(SPEED * dt);
    // um eixo por vez, pra deslizar rente à parede em vez de travar
    const a = agent.position;
    const stuck = !canWalk(a.x, a.z); // sala solta em cima dele: deixa sair
    if (stuck || canWalk(a.x + move.x, a.z)) a.x += move.x;
    if (stuck || canWalk(a.x, a.z + move.z)) a.z += move.z;
    agent.rotation.y = Math.atan2(move.x, move.z); // olhos (+z local) apontam pra onde anda
  }
  const a = agent.position, i = roomAt(a.x, a.z);
  a.y = i < 0 ? GRASS_Y : 0;
  if (i >= 0 && i !== current) { // entrou noutra sala: vira o workspace atual
    setCurrent(i);
    saveWorkspaces();
  }
  camShift.x += a.x - followed.x;
  camShift.z += a.z - followed.z;
  followed.copy(a);
  // Pernas e braços alternados (braço oposto à perna); stride suaviza o começo e a parada
  const swing = Math.sin(walk) * 0.6 * stride;
  legs[0].rotation.x = arms[1].rotation.x = swing;
  legs[1].rotation.x = arms[0].rotation.x = -swing;
  const bob = Math.abs(Math.sin(walk)) * 0.06 * stride; // quique a cada passo
  body.position.y = 0.95 + bob + Math.sin(t / 300) * 0.03; // respiração idle
  for (const e of eyes) e.scale.y = t % 3500 < 120 ? 0.1 : 1; // pisca a cada 3,5s
  const k = Math.min(dt * 6, 1); // câmera desliza atrás do agent, mantendo o pan do usuário
  camera.position.addScaledVector(camShift, k);
  camShift.multiplyScalar(1 - k);
  if (yaw !== yawTarget) { // gira em volta do ponto olhado
    const p = camera.position.sub(off);
    yaw += (yawTarget - yaw) * Math.min(dt * 10, 1);
    if (Math.abs(yawTarget - yaw) < 1e-3) yaw = yawTarget;
    p.add(off.set(20, 20, 20).applyAxisAngle(Y_AXIS, yaw));
  }
  clampCamera();
  fadeWalls();
  render();
});

// Workspaces: cada um é uma salinha numa vaga (sx, sz) do tabuleiro; guarda onde o agent estava nela (x/z locais à sala)
type Workspace = { name: string; x: number; z: number; sx: number; sz: number; parts: Rect[] };
// Formato antigo: um retângulo w×d a (ox, oz) do canto, com braços opcionais saindo de +x/+z
type Legacy = { parts?: Rect[]; w?: number; d?: number; ox?: number; oz?: number; ax?: Omit<Rect, "x" | "z">; az?: Omit<Rect, "x" | "z"> };
const square = (): Rect[] => [{ x: 0, z: 0, w: ROOM, d: ROOM }];
const WS_KEY = "astro.workspaces", CUR_KEY = "astro.workspace";
const MID = (SLOTS - 1) / 2;
let workspaces: Workspace[] = [{ name: "Astro", x: 0, z: 0, sx: MID, sz: MID, parts: square() }]; // "Astro" é o principal, no centro
let current = 0;
try {
  workspaces = JSON.parse(localStorage.getItem(WS_KEY)!) ?? workspaces;
  current = Math.min(Number(localStorage.getItem(CUR_KEY)) || 0, workspaces.length - 1);
} catch {} // storage vazio/corrompido: fica com o padrão
workspaces = workspaces.slice(0, SLOTS * SLOTS); // não cabe mais que isso no tabuleiro
current = Math.min(current, workspaces.length - 1);
for (const ws of workspaces as (Workspace & Legacy)[]) if (!ws.parts) {
  const W = ws.w ?? ROOM, D = ws.d ?? ROOM, x = ws.ox ?? 0, z = ws.oz ?? 0;
  ws.parts = [{ x, z, w: W, d: D }];
  if (ws.ax) ws.parts.push({ x: x + W, z, ...ws.ax });
  if (ws.az) ws.parts.push({ x, z: z + D, ...ws.az });
  for (const k of ["w", "d", "ox", "oz", "ax", "az"] as const) delete ws[k];
}
for (const w of workspaces) if (w.sx === undefined) { // salvos antes do tabuleiro: vaga livre mais perto do centro
  const s = freeSlot(0, 0)!;
  [w.sx, w.sz] = s;
}
workspaces.forEach((_, i) => addRoom(i));
const wsList = document.getElementById("ws-list")!;
const wsForm = document.getElementById("ws-form") as HTMLFormElement;

function saveWorkspaces() {
  const p = roomPos(current);
  workspaces[current].x = agent.position.x - p.x;
  workspaces[current].z = agent.position.z - p.z;
  try {
    localStorage.setItem(WS_KEY, JSON.stringify(workspaces));
    localStorage.setItem(CUR_KEY, String(current));
  } catch {}
}

function enterWorkspace(i: number) {
  setCurrent(i);
  const ws = workspaces[i], p = roomPos(i).add({ x: ws.x, y: 0, z: ws.z });
  const c = (v: number, side: number) => THREE.MathUtils.clamp(v, R - side / 2, side / 2 - R);
  if (roomAt(p.x, p.z) !== i || !canWalk(p.x, p.z)) // posição salva na rua (ou num pedaço que sumiu) volta pro primeiro retângulo
    p.copy(roomPos(i)).add({ x: c(ws.x, ws.parts[0].w), y: 0, z: c(ws.z, ws.parts[0].d) });
  agent.position.copy(p);
}

function setCurrent(i: number) {
  const p = roomPos(i);
  current = i;
  const ws = workspaces[i];
  sun.position.set(p.x + 8, 15, p.z + 5); // sombra só cobre ~uma sala em volta do target
  sun.target.position.copy(p);
  document.title = `Astro — ${ws.name}`;
  wsList.replaceChildren(...workspaces.map((w, j) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.textContent = w.name;
    if (j === i) b.setAttribute("aria-current", "true");
    b.onclick = () => { saveWorkspaces(); enterWorkspace(j); saveWorkspaces(); };
    li.append(b);
    return li;
  }));
}

wsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = wsForm.elements.namedItem("name") as HTMLInputElement;
  const name = input.value.trim();
  if (!name || workspaces.some((w) => w.name.toLowerCase() === name.toLowerCase())) return input.select();
  const s = freeSlot(agent.position.x, agent.position.z); // vaga livre mais perto do agent
  if (!s) return input.select(); // tabuleiro cheio
  saveWorkspaces();
  workspaces.push({ name, x: 0, z: 0, sx: s[0], sz: s[1], parts: square() });
  addRoom(workspaces.length - 1);
  enterWorkspace(workspaces.length - 1);
  saveWorkspaces();
  input.value = "";
});
addEventListener("beforeunload", saveWorkspaces);
enterWorkspace(current);
followed.copy(agent.position);
camera.position.copy(followed).setY(0).add(off); // nasce olhando o agent, sem deslizar

// Arrastar uma sala com o botão esquerdo move o workspace pra outra célula livre da grade
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), hit = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // altura do piso das salas
const pick = (e: MouseEvent) => {
  pointer.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(floorPlane, hit);
};
let dragging = -1, carry = false; // carry: o agent está dentro da sala e vai junto
addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target !== renderer.domElement || !pick(e) || grabHandle()) return;
  dragging = roomAt(hit.x, hit.z);
  carry = roomAt(agent.position.x, agent.position.z) === dragging;
  if (dragging >= 0) renderer.domElement.style.cursor = "grabbing";
});
addEventListener("pointermove", (e) => {
  if (dragging < 0) return;
  if (!(e.buttons & 1)) return endDrag(); // soltou fora da janela
  if (!pick(e)) return;
  const s = slotAt(hit.x, hit.z);
  if (!s || !fits(dragging, { ...workspaces[dragging], sx: s[0], sz: s[1] })) return; // corredor, vaga ocupada ou sala não cabe: fica onde estava
  const before = roomPos(dragging);
  [workspaces[dragging].sx, workspaces[dragging].sz] = s;
  placeRoom(dragging);
  if (!carry) return;
  const delta = roomPos(dragging).sub(before);
  agent.position.add(delta);
  followed.add(delta); // câmera não segue, senão a sala foge do cursor
});
// Modo de edição: botão direito numa sala → "Editar". Em cada borda livre de cada retângulo do piso: uma seta (dentro) que
// move a borda, de 1 em 1, e um "+" (fora) que puxa um retângulo novo dali. Encolher um retângulo até 0 apaga ele
const roomMenu = document.getElementById("room-menu")!, roomEdit = document.getElementById("room-edit")!;
const editHint = document.getElementById("edit-hint")!;
let menuRoom = -1;
renderer.domElement.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!pick(e) || (menuRoom = roomAt(hit.x, hit.z)) < 0) return;
  roomEdit.textContent = menuRoom === editing ? "Concluir edição" : "Editar";
  roomDelete.hidden = menuRoom === 0;
  roomMenu.style.left = `${e.clientX}px`;
  roomMenu.style.top = `${e.clientY}px`;
  roomMenu.togglePopover(true); // não lança se já estiver aberto
});
roomEdit.onclick = () => {
  roomMenu.hidePopover();
  setEditing(menuRoom === editing ? -1 : menuRoom);
};
const roomDelete = document.getElementById("room-delete")!;
roomDelete.onclick = () => {
  roomMenu.hidePopover();
  const i = menuRoom;
  if (i <= 0 || !confirm(`Apagar o workspace "${workspaces[i].name}"?`)) return; // "Astro" (0) é o principal: não apaga
  if (current !== i) saveWorkspaces(); // guarda onde o agent está antes dos índices mudarem
  if (editing === i) setEditing(-1);
  else if (editing > i) editing--;
  scene.remove(rooms[i]);
  rooms[i].traverse((m) => (m as THREE.Mesh).geometry?.dispose());
  rooms.splice(i, 1);
  roomWalls.splice(i, 1);
  workspaces.splice(i, 1);
  wallsVer++; // apagar a última sala não passa por addRoom
  for (let j = i; j < workspaces.length; j++) addRoom(j); // tom da sala vem do índice
  if (current === i) enterWorkspace(0); // estava dentro: volta pro principal
  else setCurrent(current > i ? current - 1 : current);
  saveWorkspaces();
};
addEventListener("keydown", (e) => { if (e.code === "Escape") setEditing(-1); });
function setEditing(i: number) {
  editing = i;
  editHint.hidden = !(handles.visible = i >= 0);
  if (i < 0) return;
  editHint.textContent = `Editando ${workspaces[i].name} — setas mudam o tamanho · + puxa um pedaço novo · Esc sai`;
  placeHandles();
}
// Seta dupla achatada no chão (uma por eixo) e "+"
const flat = (pts: number[][]) =>
  new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))).rotateX(-Math.PI / 2);
const arrowGeoX = flat([[-0.8, 0], [-0.4, 0.35], [-0.4, 0.12], [0.4, 0.12], [0.4, 0.35],
  [0.8, 0], [0.4, -0.35], [0.4, -0.12], [-0.4, -0.12], [-0.4, -0.35]]);
const arrowGeoZ = arrowGeoX.clone().rotateY(Math.PI / 2);
const plusGeo = flat([[-0.2, 0.6], [0.2, 0.6], [0.2, 0.2], [0.6, 0.2], [0.6, -0.2], [0.2, -0.2],
  [0.2, -0.6], [-0.2, -0.6], [-0.2, -0.2], [-0.6, -0.2], [-0.6, 0.2], [-0.2, 0.2]]);
const arrowMat = new THREE.MeshBasicMaterial({ color: ORANGE });
const handles = new THREE.Group();
handles.visible = false;
scene.add(handles);
type Side = { part: number; axis: "x" | "z"; dir: 1 | -1 }; // uma borda de um retângulo; dir -1 = lado de trás
// Posição local da borda no eixo dela
const edgeAt = (r: Rect, { axis, dir }: Side) => axis === "x" ? (dir > 0 ? r.x + r.w : r.x) : (dir > 0 ? r.z + r.d : r.z);
// Maior trecho [a, b) da borda sem piso logo do lado de fora, ou null se ela encosta em piso toda
function freeRun(parts: Rect[], cells: Set<string>, side: Side): [number, number] | null {
  const r = parts[side.part], x = side.axis === "x", out = edgeAt(r, side) - (side.dir < 0 ? 1 : 0);
  const [a0, a1] = x ? [r.z, r.z + r.d] : [r.x, r.x + r.w];
  let best: [number, number] | null = null;
  for (let a = a0, s = a0; a <= a1; a++) {
    if (a < a1 && !cells.has(x ? key(out, a) : key(a, out))) continue;
    if (a > s && (!best || a - s > best[1] - best[0])) best = [s, a];
    s = a + 1;
  }
  return best;
}
function placeHandles() { // refeitas a cada mudança: seta rente à borda por dentro, "+" na grama por fora, no meio do trecho livre
  handles.clear();
  const ws = workspaces[editing], c = corner(ws), cells = cellsIn(ws.parts);
  ws.parts.forEach((r, part) => {
    for (const axis of ["x", "z"] as const) for (const dir of [1, -1] as const) {
      const side = { part, axis, dir }, run = freeRun(ws.parts, cells, side);
      if (!run) continue;
      const mid = (run[0] + run[1]) / 2, edge = edgeAt(r, side);
      const at = (m: THREE.Mesh, off: number, y: number) =>
        axis === "x" ? m.position.set(c.x + edge + off, y, c.z + mid) : m.position.set(c.x + mid, y, c.z + edge + off);
      const arrow = new THREE.Mesh(axis === "x" ? arrowGeoX : arrowGeoZ, arrowMat), plus = new THREE.Mesh(plusGeo, arrowMat);
      at(arrow, -dir * 0.9, 0.02);
      at(plus, dir * 1.2, GRASS_Y + 0.03);
      arrow.userData.side = plus.userData.side = side;
      plus.userData.run = run;
      handles.add(arrow);
      // canto de dentro: dois "+" quase no mesmo lugar viram um só
      if (!handles.children.some((h) => h.userData.run && h.position.distanceTo(plus.position) < 2)) handles.add(plus);
    }
  });
}
// Cópia de ws com a borda `side` movida pra o retângulo ficar com `size` no eixo dela (a borda oposta fica parada)
function resized(ws: Workspace, { part, axis, dir }: Side, size: number): Workspace {
  const n: Workspace = structuredClone(ws), r = n.parts[part];
  if (axis === "x") { if (dir < 0) r.x += r.w - size; r.w = size; }
  else { if (dir < 0) r.z += r.d - size; r.d = size; }
  return n;
}
let resizing: Side | null = null, grabOff = 0; // grabOff: distância do cursor à borda, pra borda não pular pro cursor
// Chamado no pointerdown depois do pick: true se pegou uma seta ou um "+"
function grabHandle() {
  if (editing < 0) return false;
  const h = raycaster.intersectObjects(handles.children, false)[0]?.object;
  if (!h) return false;
  const ws = workspaces[editing];
  let side: Side = h.userData.side;
  if (h.userData.run) { // "+": retângulo novo colado na borda, com metade do trecho livre (do lado de trás), crescendo pra fora
    const [a, b] = h.userData.run as [number, number], edge = edgeAt(ws.parts[side.part], side), n = Math.ceil((b - a) / 2);
    ws.parts.push(side.axis === "x" ? { x: edge, z: a, w: 0, d: n } : { x: a, z: edge, w: n, d: 0 });
    side = { ...side, part: ws.parts.length - 1 };
  }
  resizing = side;
  const c = corner(ws);
  grabOff = edgeAt(ws.parts[side.part], side) + (side.axis === "x" ? c.x - hit.x : c.z - hit.z);
  renderer.domElement.style.cursor = "grabbing"; // ew/ns-resize mentiriam: no isométrico os eixos são diagonais
  return true;
}
addEventListener("pointermove", (e) => {
  if (!resizing || !pick(e)) return;
  const ws = workspaces[editing], { part, axis, dir } = resizing, r = ws.parts[part], x = axis === "x", c = corner(ws);
  const start = x ? c.x + r.x : c.z + r.z, len = x ? r.w : r.d, edge = Math.round((x ? hit.x : hit.z) + grabOff);
  const min = ws.parts.length > 1 ? 0 : ROOM_MIN; // com outros pedaços, dá pra encolher até sumir
  let size = THREE.MathUtils.clamp(dir > 0 ? edge - start : start + len - edge, min, BOARD), next: Workspace;
  while (!fits(editing, next = resized(ws, resizing, size))) size--; // para antes da vaga ocupada
  if (JSON.stringify(next) === JSON.stringify(ws)) return;
  workspaces[editing] = next;
  addRoom(editing);
});
addEventListener("pointerup", () => {
  if (!resizing) return;
  resizing = null;
  renderer.domElement.style.cursor = "";
  const ws = workspaces[editing];
  ws.parts = ws.parts.filter((r) => r.w > 0 && r.d > 0); // encolhido até sumir
  addRoom(editing);
  setCurrent(current); // sol volta pro centro da sala
  saveWorkspaces();
});
// ponytail: encolher um retângulo do meio pode deixar pedaços soltos; checar conectividade se isso incomodar
function endDrag() {
  if (dragging < 0) return;
  dragging = -1;
  renderer.domElement.style.cursor = "";
  setCurrent(current); // sol volta pra cima da sala, se ela mudou de lugar
  saveWorkspaces();
}
addEventListener("pointerup", endDrag);

// Arrastar com o botão do meio move a câmera (pan no plano da tela)
let panning = false;
const right = new THREE.Vector3(), up = new THREE.Vector3();
addEventListener("pointerdown", (e) => {
  if (e.button !== 1) return;
  e.preventDefault(); // evita o autoscroll do navegador
  panning = true;
});
addEventListener("pointermove", (e) => {
  if (panning && !(e.buttons & 4)) panning = false; // botão do meio solto (mesmo fora da janela)
  if (!panning) return;
  const unitsPerPx = VIEW / camera.zoom / innerHeight;
  right.setFromMatrixColumn(camera.matrix, 0);
  up.setFromMatrixColumn(camera.matrix, 1);
  camera.position
    .addScaledVector(right, -e.movementX * unitsPerPx)
    .addScaledVector(up, e.movementY * unitsPerPx);
});
