const KCOL = { A: "#2F9E44", B: "#F59F00", C: "#E03131", "Sans historique": "#7048E8" };
const KLAB = { A: "Classe A", B: "Classe B", C: "Classe C", "Sans historique": "Sans historique" };
const ZLAB = { P: "Sous le portique", M: "Cantilevers milieu", E: "Cantilevers Est" };
const CAP = { P: 31, M: 64, E: 64 };
const fr = (n) => Math.round(n).toLocaleString("fr-FR");
const $ = (id) => document.getElementById(id);
const occCol = (p) => (p <= 85 ? "#2F9E44" : p <= 92 ? "#F59F00" : "#E03131");
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  },
};

/* ---------- Colonne de gauche ---------- */
function setSide(collapsed) {
  document.body.classList.toggle("side-collapsed", collapsed);
  const b = $("sideToggle");
  b.setAttribute("aria-expanded", String(!collapsed));
  b.setAttribute("aria-label", collapsed ? "Afficher la colonne de gauche" : "Masquer la colonne de gauche");
  b.title = b.getAttribute("aria-label");
  store.set("at1-side", collapsed);
}
$("sideToggle").addEventListener("click", () => setSide(!document.body.classList.contains("side-collapsed")));
setSide(!!store.get("at1-side"));

/* ---------- Thème ---------- */
document.documentElement.dataset.theme = "light"; // thème clair uniquement

/* ---------- Géométrie ---------- */
// Cantilevers : dimensions et écartement selon le plan fournisseur Provost (racks 5 976 × 1 958 mm, allées de 3 000 mm).
// Rangées poussées vers le portique, avec 1 m de recul : allée est de 3 m jusqu'à x = 107,9 m (limite du portique à 108,9 m) ;
// zone milieu à ras de la voie ferrée (bord des traverses, z = 1,05 m), zone Est à ras de la zone hachurée rouge (z = -13,5 m).
const CANT = { base: 1.958, len: 5.976, aisle: 3.0, xLimit: 108.9 - 1.0, railEdge: 1.05, redEdge: -13.5 };
const RACK_X = [0, 1, 2, 3].map((i) => CANT.xLimit - CANT.aisle - CANT.base / 2 - (3 - i) * (CANT.base + CANT.aisle));
const ROW_Z = { E: CANT.redEdge + CANT.len / 2, M: CANT.railEdge + CANT.len / 2 };
const COLS_Z = [-2.85, -1.9, -0.95, 0, 0.95, 1.9, 2.85];
// niveaux (vue de profil) : niveau 1 sur les pieds de 300 mm, bras de 1 063 à 5 225 mm (600 mm utiles)
const levelY = (lv) => (lv === 1 ? 0.31 : 1.063 + (lv - 2) * 0.6937 + 0.04);
const POR = { x0: 109.43, w: 15.88, zs: 25.2, n: 31, n1: 7, bandS: 16.7, bandN: 12.0, pitch: 1.3, pile: 0.5 }; // zone camion + 1 m de sécurité de chaque côté : z 12,0 à 16,7
const porZ = (s) =>
  s <= POR.n1 ? POR.zs - POR.pile / 2 - (s - 1) * POR.pitch : POR.bandN - POR.pile / 2 - (s - POR.n1 - 1) * POR.pitch;
const cantSlot = (s) => {
  const c = Math.floor((s - 1) / 8),
    lv = ((s - 1) % 8) + 1;
  return { t: Math.floor(c / 2) + 1, face: c % 2 ? "B" : "A", lv };
};
function addr(z, s) {
  if (z === "P") return "POR-" + String(s).padStart(3, "0");
  const k = cantSlot(s);
  return (z === "M" ? "MIL" : "EST") + "-T" + k.t + "-" + String((k.face === "A" ? 0 : 8) + k.lv).padStart(3, "0");
}
function addrLong(z, s) {
  if (z === "P") return addr(z, s) + " (au sol sous le portique)";
  const k = cantSlot(s);
  return `${addr(z, s)} (travée ${k.t}, face ${k.face}, niveau ${k.lv})`;
}
const okIn = (r, z) => z === "P" || r.l === 6;

/* ---------- Emplacements ---------- */
const ORIG = {},
  ORIGPOS = {};
REFS.forEach((r) => {
  ORIG[r.c] = { d: r.d, l: r.l, k: r.k, b: r.b, w: r.w };
  let k = 0;
  for (let s = r.s; s <= r.e; s++) ORIGPOS[r.c + "#" + k++] = { z: r.z, s };
});
const PIECES = [];
const IN_CLAUDE = !!(window.claude && window.claude.use);
const MODE = window.AT1_MODE || ""; // "consultation" ou "edition" : version hébergée sur GitHub
const PUBLISHED = window.PLAN && window.PLAN.v === 1 ? window.PLAN : null;
let ROLE = MODE === "consultation" ? "viewer" : MODE === "edition" ? "local" : IN_CLAUDE ? "viewer" : "local",
  DOC = null,
  lastRev = null,
  pushT = null;
const FILE_STATE = { refs: REFS.map((r) => ({ c: r.c, d: r.d, l: r.l, k: r.k, b: r.b, w: r.w })), pieces: [] };
REFS.forEach((r) => {
  let k = 0;
  for (let s = r.s; s <= r.e; s++) FILE_STATE.pieces.push({ id: r.c + "#" + k++, c: r.c, z: r.z, s });
});
const canEditPlan = () => ROLE !== "viewer";
const DRAFT_KEY = MODE === "edition" ? "at1-draft" : "at1-state";
const saved =
  MODE === "consultation"
    ? PUBLISHED
    : MODE === "edition"
      ? store.get(DRAFT_KEY) || PUBLISHED
      : IN_CLAUDE
        ? null
        : store.get(DRAFT_KEY);
if (saved && saved.v === 1) {
  REFS.length = 0;
  saved.refs.forEach((r) => REFS.push(r));
  saved.pieces.forEach((p) => {
    const r = REFS.find((x) => x.c === p.c);
    if (r) PIECES.push({ id: p.id, r, z: p.z, s: p.s });
  });
} else
  REFS.forEach((r) => {
    let k = 0;
    for (let s = r.s; s <= r.e; s++) PIECES.push({ id: r.c + "#" + k++, r, z: r.z, s });
  });
const syncN = (r) => {
  r.n = Math.max(1, PIECES.filter((p) => p.r === r).length);
  r.q = Math.round(r.w / r.n);
};
REFS.forEach(syncN);
const stateNow = () => ({
  v: 1,
  refs: REFS.map((r) => ({ c: r.c, d: r.d, l: r.l, k: r.k, b: r.b, w: r.w, n: r.n, q: r.q })),
  pieces: PIECES.map((p) => ({ id: p.id, c: p.r.c, z: p.z, s: p.s })),
  hidden: [...(typeof hiddenRacks !== "undefined" ? hiddenRacks : [])],
});
function save() {
  if (ROLE === "local") {
    store.set(DRAFT_KEY, stateNow());
    return;
  }
  if (ROLE !== "editor" || !DOC) return;
  clearTimeout(pushT);
  pushT = setTimeout(async () => {
    const st = stateNow();
    st.rev = Math.random().toString(36).slice(2);
    st.at = Date.now();
    lastRev = st.rev;
    try {
      await DOC.set(st);
      showUpdated(st.at);
    } catch (e) {
      planMsg("Enregistrement refusé : vos droits ne permettent pas de modifier le plan.", true);
    }
  }, 500);
}
const occupied = () => {
  const o = { P: new Map(), M: new Map(), E: new Map() };
  PIECES.forEach((p) => o[p.z].set(p.s, p));
  return o;
};
const piecesOf = (c) => PIECES.filter((p) => p.r.c === c);

/* ---------- Maquette 3D ---------- */
const stage = $("stage"),
  canvas = $("c3d");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const pcam = new THREE.PerspectiveCamera(48, 1, 0.1, 1500),
  ocam = new THREE.OrthographicCamera(-50, 50, 30, -30, 0.1, 1000);
let camera = pcam;
const controls = new THREE.OrbitControls(pcam, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 420;
controls.addEventListener("start", () => {
  userMoved = true;
});
const ocontrols = new THREE.OrbitControls(ocam, canvas);
ocontrols.enableRotate = false;
ocontrols.screenSpacePanning = true;
ocontrols.enableDamping = true;
ocontrols.minZoom = 0.6;
ocontrols.maxZoom = 60;
ocontrols.enabled = false;
ocontrols.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
ocontrols.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
const hemi = new THREE.HemisphereLight(0xffffff, 0x7d868e, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.65);
scene.add(sun);

const G = {};
[
  "sky",
  "ground",
  "walls",
  "roofs",
  "items",
  "vehicles",
  "cranes",
  "workers",
  "charges",
  "free",
  "labels",
  "cotes",
].forEach((k) => {
  G[k] = new THREE.Group();
  scene.add(G[k]);
});
let cur = G.ground;
const MC = {};
const mat = (c, o) => {
  const k = c + "|" + (o || 1);
  if (!MC[k])
    MC[k] = new THREE.MeshLambertMaterial(
      o ? { color: c, transparent: true, opacity: o, depthWrite: o > 0.6 } : { color: c },
    );
  return MC[k];
};
const box = (w, h, d, m, x, y, z, ry) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  if (ry) o.rotation.y = ry;
  cur.add(o);
  return o;
};
function stripes(c1, c2) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = c1;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = c2;
  g.lineWidth = 12;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 64, 0);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.6, 0.6);
  return t;
}
function poly(pts, y, m) {
  const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const o = new THREE.Mesh(new THREE.ShapeGeometry(sh), m);
  o.rotation.x = -Math.PI / 2;
  o.position.y = y;
  cur.add(o);
  return o;
}

/* ---------- Météo et heure ---------- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { top: { value: new THREE.Color("#4f8fd6") }, hor: { value: new THREE.Color("#cfe3f5") } },
  vertexShader:
    "varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader:
    "uniform vec3 top; uniform vec3 hor; varying vec3 vp; void main(){ float h = clamp(vp.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, h), 1.0); }",
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), skyMat);
G.sky.add(sky);
function radial(stops, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d"),
    gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const sunSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: radial([
      [0, "rgba(255,255,240,1)"],
      [0.18, "rgba(255,244,200,1)"],
      [0.4, "rgba(255,230,150,.35)"],
      [1, "rgba(255,220,120,0)"],
    ]),
    depthWrite: false,
    fog: false,
  }),
);
sunSprite.scale.set(90, 90, 1);
G.sky.add(sunSprite);
function cloudTex() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 176,
      y = 50 + Math.random() * 40,
      r = 22 + Math.random() * 30,
      gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(255,255,255,.9)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}
const clouds = [];
const cTex = [cloudTex(), cloudTex(), cloudTex()];
for (let i = 0; i < 48; i++) {
  const m = new THREE.SpriteMaterial({ map: cTex[i % 3], transparent: true, depthWrite: false, fog: false });
  const sp = new THREE.Sprite(m);
  const a = Math.random() * Math.PI * 2,
    rr = 60 + Math.random() * 300;
  sp.position.set(60 + Math.cos(a) * rr, 70 + Math.random() * 50, Math.sin(a) * rr * 0.7);
  const sc = 50 + Math.random() * 60;
  sp.scale.set(sc * 2, sc, 1);
  G.sky.add(sp);
  clouds.push(sp);
}
const RAIN_N = 2600,
  rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = -20 + Math.random() * 180,
    y = Math.random() * 60,
    z = -60 + Math.random() * 120;
  rainPos.set([x, y, z, x - 0.05, y - 0.9, z], i * 6);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(
  rainGeo,
  new THREE.LineBasicMaterial({ color: 0xb7c4d0, transparent: true, opacity: 0.55 }),
);
rain.visible = false;
scene.add(rain);
const WX = {
  soleil: { top: "#3f86d8", hor: "#d3e6f6", sun: 0.85, hemi: 0.8, n: 5, cc: "#ffffff", fog: null, rain: false },
  nuages: { top: "#5d90c6", hor: "#d8e3ec", sun: 0.62, hemi: 0.78, n: 24, cc: "#ffffff", fog: null, rain: false },
  couvert: {
    top: "#8a949e",
    hor: "#c9ced3",
    sun: 0.18,
    hemi: 0.9,
    n: 44,
    cc: "#c3c8cd",
    fog: [0xc6cbd0, 140, 520],
    rain: false,
  },
  pluie: {
    top: "#5f676f",
    hor: "#a3aab1",
    sun: 0.08,
    hemi: 0.72,
    n: 48,
    cc: "#8f969c",
    fog: [0x9ba2a8, 90, 380],
    rain: true,
  },
};
let weather = store.get("at1-wx") || "nuages",
  hour = store.get("at1-hour") || 14;
function applyWeather() {
  const w = WX[weather];
  skyMat.uniforms.top.value.set(w.top);
  skyMat.uniforms.hor.value.set(w.hor);
  const t = (hour - 6) / 14,
    el = Math.sin(Math.PI * t) * 1.05 + 0.04,
    az = Math.PI * (0.15 + 0.7 * t);
  const dir = new THREE.Vector3(
    Math.cos(az) * Math.cos(el),
    Math.sin(el),
    -Math.sin(az) * Math.cos(el) * 0.6,
  ).normalize();
  sun.position
    .copy(dir)
    .multiplyScalar(200)
    .add(new THREE.Vector3(60, 0, 0));
  sunSprite.position
    .copy(dir)
    .multiplyScalar(600)
    .add(new THREE.Vector3(60, 0, 0));
  const warm = Math.max(0, 1 - Math.sin(Math.PI * t) * 2.2);
  sun.color.setRGB(1, 1 - warm * 0.25, 1 - warm * 0.5);
  sun.intensity = w.sun * (0.55 + 0.45 * Math.sin(Math.PI * t));
  hemi.intensity = w.hemi * (0.75 + 0.25 * Math.sin(Math.PI * t));
  sunSprite.visible = w.sun > 0.3;
  sunSprite.material.opacity = Math.min(1, w.sun * 1.2);
  clouds.forEach((c, i) => {
    c.visible = i < w.n;
    c.material.color.set(w.cc);
    c.material.opacity = weather === "soleil" ? 0.8 : 0.92;
  });
  scene.fog = w.fog ? new THREE.Fog(...w.fog) : null;
  rain.visible = w.rain && mode !== "plan";
  document
    .querySelectorAll("#wx button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.wx === weather)));
  $("hour").value = hour;
  $("hourOut").textContent = `${Math.floor(hour)} h ${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
  store.set("at1-wx", weather);
  store.set("at1-hour", hour);
}
document.querySelectorAll("#wx button").forEach((b) =>
  b.addEventListener("click", () => {
    weather = b.dataset.wx;
    applyWeather();
  }),
);
$("hour").addEventListener("input", (e) => {
  hour = +e.target.value;
  applyWeather();
});

/* ---------- Sol ---------- */
box(320, 0.05, 110, mat(0x5b6268), 0, -0.03, 0);
const SURF = {
  43: mat(0xd3d7da),
  54: mat(0x8d949a),
  75: mat(0x6e9e4f),
  579: new THREE.MeshLambertMaterial({ map: stripes("#ffffff", "#5ec43a") }),
  580: new THREE.MeshLambertMaterial({ map: stripes("#ffffff", "#d64545") }),
  582: mat(0x5d646b),
};
SITE.surf.forEach((s, i) => poly(s.p, 0.006 + (s.m === "43" ? 0 : 0.002 + i * 0.001), SURF[s.m] || mat(0xbfc4c8)));
function track(x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0),
    ang = -Math.atan2(z1 - z0, x1 - x0),
    cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2,
    nx = -(z1 - z0) / len,
    nz = (x1 - x0) / len;
  [-0.72, 0.72].forEach((o) => box(len, 0.12, 0.08, mat(0x4a525a), cx + nx * o, 0.08, cz + nz * o, ang));
  const n = Math.floor(len / 0.6),
    inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.06, 2.1), mat(0x7f705e), n),
    m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    m4.compose(new THREE.Vector3(x0 + (x1 - x0) * t, 0.03, z0 + (z1 - z0) * t), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m4);
  }
  cur.add(inst);
}
const PATHC = {
  3: [0xf2c230, 0.45],
  5: [0xf2c230, 0.45],
  12: [0x7d858c, 0.75],
  10: [0x7d858c, 0.75],
  1: [0x3da35d, 0.5],
  7: [0x3da35d, 0.5],
};
const inCantZone = (x, z) => x > 76 && x < 110 && z > -15 && z < 12;
SITE.paths.forEach((p) => {
  for (let i = 0; i < p.p.length - 1; i++) {
    const [x0, z0] = p.p[i],
      [x1, z1] = p.p[i + 1];
    if ((p.t === 3 || p.t === 5) && inCantZone((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    if (p.t === 11) {
      track(x0, z0, x1, z1);
      continue;
    }
    const c = PATHC[p.t] || [0x9aa3ab, 0.4],
      len = Math.hypot(x1 - x0, z1 - z0);
    box(
      len + p.w * 0.5,
      0.02,
      p.w,
      mat(c[0], c[1]),
      (x0 + x1) / 2,
      0.015,
      (z0 + z1) / 2,
      -Math.atan2(z1 - z0, x1 - x0),
    );
  }
});

/* ---------- Bâtiments ---------- */
cur = G.walls;
SITE.walls.forEach((w) => {
  const [x0, z0, x1, z1, t, h] = w,
    len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.05) return;
  box(len + t, h, t, mat(0xe9ebed), (x0 + x1) / 2, h / 2, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0));
});
// portes et fenêtres des bâtiments
const rollTex = (() => {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#c9ced3";
  g.fillRect(0, 0, 16, 64);
  g.fillStyle = "#9aa2a9";
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 16, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 4);
  return t;
})();
const OPM = {
  frame: mat(0xffffff),
  glass: new THREE.MeshLambertMaterial({ color: 0x7fb0d4, transparent: true, opacity: 0.85 }),
  door: mat(0x56616b),
  roll: new THREE.MeshLambertMaterial({ map: rollTex }),
  grid: mat(0x50585f, 0.6),
};
(SITE.openings || []).forEach((o) => {
  const [k, x, z, y0, w, l, h, rot] = o,
    ry = (-rot * Math.PI) / 180;
  if (k === "grid") {
    box(w, h, 0.05, OPM.grid, x, y0 + h / 2, z, ry);
    return;
  }
  if (k === "roll" || k === "door") {
    box(w + 0.12, h + 0.08, 0.34, OPM.frame, x, y0 + (h + 0.08) / 2, z, ry);
    box(w, h, 0.38, k === "roll" ? OPM.roll : OPM.door, x, y0 + h / 2, z, ry);
    return;
  }
  box(w + 0.1, h + 0.1, 0.34, OPM.frame, x, y0 + h / 2, z, ry);
  box(Math.max(0.1, w - 0.1), Math.max(0.1, h - 0.1), 0.38, OPM.glass, x, y0 + h / 2, z, ry);
  if (k === "win" || k === "bay") box(0.05, h - 0.1, 0.4, OPM.frame, x, y0 + h / 2, z, ry);
});
cur = G.roofs;
const tileTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#c4683f";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#a9532f";
  g.fillRect(0, 26, 64, 6);
  g.fillRect(0, 58, 64, 6);
  g.fillStyle = "rgba(0,0,0,.18)";
  for (let x = 0; x < 64; x += 16) {
    g.fillRect(x, 0, 2, 32);
    g.fillRect(x + 8, 32, 2, 32);
  }
  g.fillStyle = "rgba(255,255,255,.08)";
  g.fillRect(0, 0, 64, 10);
  g.fillRect(0, 32, 64, 10);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const tileMat = new THREE.MeshLambertMaterial({ map: tileTex, side: THREE.DoubleSide });
function hipRoof(pts, h, ang, ovs = {}) {
  // ovs : débord par côté (n, s, o, e), 0,5 m par défaut
  const xs = pts.map((p) => p[0]),
    zs = pts.map((p) => p[1]),
    o = (k) => ovs[k] ?? 0.5;
  const x0 = Math.min(...xs) - o("o"),
    x1 = Math.max(...xs) + o("e"),
    z0 = Math.min(...zs) - o("n"),
    z1 = Math.max(...zs) + o("s");
  const along = x1 - x0 >= z1 - z0,
    L = along ? x1 - x0 : z1 - z0,
    W = along ? z1 - z0 : x1 - x0,
    rise = (W / 2) * Math.tan((ang * Math.PI) / 180),
    cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  const P = (u, v, y) => (along ? [cx + u, h + y, cz + v] : [cx + v, h + y, cz + u]),
    hl = L / 2,
    hw = W / 2,
    rl = Math.max(0, hl - hw);
  const A = P(-hl, -hw, 0),
    B = P(hl, -hw, 0),
    C = P(hl, hw, 0),
    D = P(-hl, hw, 0),
    E = P(-rl, 0, rise),
    F = P(rl, 0, rise);
  const faces = [
      [A, B, F, 0],
      [A, F, E, 0],
      [C, D, E, 0],
      [C, E, F, 0],
      [B, C, F, 1],
      [D, A, E, 1],
    ],
    pos = [],
    uv = [];
  faces.forEach(([p, q, r, end]) =>
    [p, q, r].forEach((v) => {
      pos.push(...v);
      const run = end ? (along ? v[2] : v[0]) : along ? v[0] : v[2];
      uv.push(run / 1.2, (v[1] - h) / Math.sin((ang * Math.PI) / 180) / 0.6);
    }),
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  cur.add(new THREE.Mesh(g, tileMat));
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(along ? 2 * rl + 0.3 : 0.3, 0.22, along ? 0.3 : 2 * rl + 0.3),
    mat(0x8e3f22),
  );
  ridge.position.set(cx, h + rise + 0.05, cz);
  cur.add(ridge);
}
// bâtiment au sud du portique : pas de débord côté portique (sinon le toit rentre dans les pieds sud)
const nearPortique = (r) =>
  Math.min(...r.p.map((p) => p[1])) > 26 &&
  Math.max(...r.p.map((p) => p[0])) > 100 &&
  Math.min(...r.p.map((p) => p[0])) < 126;
SITE.roofs.forEach((r) => {
  if (r.t === "multiPanel") hipRoof(r.p, r.h, r.a || 25, nearPortique(r) ? { n: 0 } : {});
  else {
    const o = poly(r.p, r.h + 0.02, new THREE.MeshLambertMaterial({ color: 0x8e979f, side: THREE.DoubleSide }));
  }
});

/* ---------- Véhicules et opérateurs ---------- */
const WHEEL = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18);
WHEEL.rotateX(Math.PI / 2);
function vehicle(kind, color, len, wid, hei) {
  const g = new THREE.Group(),
    add = (w, h, d, m, x, y, z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z);
      g.add(o);
      return o;
    };
  const glass = mat(0x27323c),
    tyre = mat(0x1d2024),
    wheels = (xs) =>
      xs.forEach((x) =>
        [-1, 1].forEach((s) => {
          const w = new THREE.Mesh(WHEEL, tyre);
          w.position.set(x, 0.36, s * (wid / 2 - 0.12));
          g.add(w);
        }),
      );
  if (kind === "vl") {
    add(len, 0.62, wid, mat(color), 0, 0.62, 0);
    add(len * 0.52, 0.5, wid * 0.86, mat(color), -len * 0.05, 1.17, 0);
    add(len * 0.53, 0.38, wid * 0.88, glass, -len * 0.05, 1.15, 0);
    wheels([-len * 0.32, len * 0.32]);
  } else if (kind === "vul") {
    add(len, 1.55, wid, mat(color), -len * 0.06, 1.15, 0);
    add(len * 0.22, 1.0, wid, mat(color), len * 0.39, 0.85, 0);
    add(len * 0.12, 0.45, wid * 0.9, glass, len * 0.42, 1.25, 0);
    wheels([-len * 0.33, len * 0.34]);
  } else if (kind === "camion") {
    const cab = 2.3,
      bh = Math.max(2.4, hei - 1.1);
    add(cab, 2.7, wid, mat(0x2f5fa8), len / 2 - cab / 2, 1.85, 0);
    add(0.12, 0.9, wid * 0.92, glass, len / 2 + 0.01, 2.5, 0);
    add(len - cab - 0.3, bh, wid, mat(0xf3f4f5), -cab / 2 - 0.15, 1.2 + bh / 2, 0);
    add(len - 0.4, 0.3, wid * 0.9, mat(0x50565c), 0, 0.75, 0);
    wheels([len / 2 - 1.2, -len / 2 + 1.6, -len / 2 + 2.9]);
  } else {
    const bh = Math.max(2.4, hei - 1.1);
    add(len, bh, wid, mat(0xf3f4f5), 0, 1.2 + bh / 2, 0);
    add(len, 0.3, wid * 0.9, mat(0x50565c), 0, 0.75, 0);
    for (let i = 0; i < 7; i++)
      add(0.5, 0.25, 0.02, mat(i % 2 ? 0xffffff : 0xd64545), -len / 2 + 0.6 + i * 0.6, 1.0, wid / 2 + 0.01);
    wheels([-len / 2 + 1.4, -len / 2 + 2.7, -len / 2 + 4.0]);
  }
  return g;
}
const ICOL = {
  pal: 0xc9a27e,
  palv: 0xb08a63,
  prot: 0xf2c230,
  barr: 0xf2c230,
  chariot: 0x9aa3ab,
  benne: 0x4e7d5b,
  rack: 0x3557c9,
  etag: 0x8e99a3,
  cubi: 0xf4f4f4,
  cont: 0x4d8b57,
  engin: 0xe8a33d,
  tech: 0xc0c6cc,
  pergola: 0x8a8f94,
  mob: 0xb9b0a6,
};
const VLC = [0x3b6ea5, 0xe8e8e8, 0x6b7078, 0xb83a3a];
const VEH = [];
SITE.items.forEach((it, i) => {
  const [c, n, x, z, y0, w, l, h, rot] = it;
  if (c === "vl" || c === "pl") {
    VEH.push(it);
    return;
  }
  cur = G.items;
  if (c === "barr") {
    const g = new THREE.Group(),
      y = mat(0xf2c230),
      len = Math.max(w, l),
      n = Math.max(2, Math.round(len / 1.2) + 1);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), y);
      p.position.set(-len / 2 + (k * len) / (n - 1), h / 2, 0);
      g.add(p);
    }
    [h * 0.95, h * 0.5].forEach((yy) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), y);
      r.position.set(0, yy, 0);
      g.add(r);
    });
    g.position.set(x, y0, z);
    g.rotation.y = (-rot * Math.PI) / 180 + (l > w ? Math.PI / 2 : 0);
    cur.add(g);
    return;
  }
  box(
    w,
    h,
    l,
    c === "rack" || c === "pergola" ? mat(ICOL[c], 0.55) : mat(ICOL[c]),
    x,
    y0 + h / 2,
    z,
    (-rot * Math.PI) / 180,
  );
});
/* ---------- Véhicules 3D ---------- */
const CARC = [0x8e1b1b, 0xd9dcdf, 0x1f3f73, 0x2b2f33, 0x6f7780, 0xf3f4f5];
function b64buf(t) {
  const bin = atob(t),
    u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
const loadGLB = (key) =>
  new Promise((res, rej) => {
    try {
      if (!THREE.GLTFLoader) throw new Error("chargeur absent");
      new THREE.GLTFLoader().parse(b64buf(GLB[key]), "", (g) => res(g.scene), rej);
    } catch (e) {
      rej(e);
    }
  });
const WHT = new THREE.CylinderGeometry(0.52, 0.52, 0.34, 22);
WHT.rotateZ(Math.PI / 2);
function tractor(k) {
  // tracteur routier, avant vers +z
  const g = new THREE.Group(),
    add = (w, h, d, m, x, y, z) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z);
      g.add(o);
      return o;
    };
  const body = mat([0x1f4e9c, 0xf3f4f5, 0xb3261e][k % 3]),
    dark = mat(0x23272b),
    glass = mat(0x1a2631),
    chrome = mat(0xc9cfd5),
    lamp = mat(0xfff4d6),
    tyre = mat(0x1b1e21),
    rim = mat(0x9aa3ab);
  add(2.5, 2.5, 2.3, body, 0, 2.55, 0.2);
  add(2.46, 0.65, 2.2, body, 0, 4.1, 0.15);
  add(2.3, 1.05, 0.06, glass, 0, 3.0, 1.37);
  [-1, 1].forEach((sg) => {
    add(0.06, 0.95, 1.5, glass, sg * 1.26, 3.0, 0.4);
    add(0.1, 0.55, 0.22, dark, sg * 1.42, 3.05, 1.15);
    add(0.42, 0.18, 0.05, lamp, sg * 0.92, 1.3, 1.43);
    add(0.5, 0.06, 1.7, dark, sg * 1.2, 1.15, 0.2);
  });
  add(1.9, 0.8, 0.06, dark, 0, 1.85, 1.37);
  add(2.56, 0.38, 0.34, dark, 0, 0.98, 1.3);
  add(1.0, 0.34, 5.8, dark, 0, 0.86, -1.6);
  add(1.5, 0.14, 1.5, dark, 0, 1.12, -2.6);
  add(0.65, 0.6, 1.1, chrome, 1.12, 1.05, -0.95);
  add(0.65, 0.6, 1.1, chrome, -1.12, 1.05, -0.95);
  [
    [0.62, 2],
    [-2.25, 4],
    [-3.55, 4],
  ].forEach(([zz, n]) =>
    [-1, 1].forEach((sg) => {
      const t = new THREE.Mesh(WHT, tyre);
      t.position.set(sg * 1.05, 0.52, zz);
      g.add(t);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.36, 14).rotateZ(Math.PI / 2), rim);
      r.position.copy(t.position);
      g.add(r);
    }),
  );
  return g;
}
function recolor(o, col) {
  o.traverse((m) => {
    if (m.isMesh && m.material && m.material.name === "red") {
      m.material = m.material.clone();
      m.material.color.setHex(col);
    }
  });
}
const bayMat = new THREE.MeshBasicMaterial({ color: 0xf4f6f8 });
function bayAt(x, z, ry) {
  // place de stationnement : 2,5 m × 5 m, lignes blanches peintes au sol
  const g = new THREE.Group(),
    L = 5.0,
    Wd = 2.5,
    t = 0.12;
  [
    [0, -L / 2, Wd, t],
    [0, L / 2, Wd, t],
    [-Wd / 2, 0, t, L],
    [Wd / 2, 0, t, L],
  ].forEach(([dx, dz, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), bayMat);
    m.position.set(dx, 0.03, dz);
    g.add(m);
  });
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  G.vehicles.add(g);
}
function buildVehicles(M) {
  VEH.forEach((it, i) => {
    const [c, n, x, z, y0, w, l, h, rot] = it,
      len = Math.max(w, l),
      wid = Math.min(w, l);
    let g;
    if (!M) {
      const kind = n === "Camion" ? "camion" : n.startsWith("Remorque") ? "remorque" : n === "VUL" ? "vul" : "vl";
      g = vehicle(kind, VLC[i % VLC.length], len, wid, h);
      g.rotation.y = (-rot * Math.PI) / 180 + (l > w ? Math.PI / 2 : 0);
    } else {
      if (n === "Camion" || n.startsWith("Remorque")) {
        const truck = n === "Camion",
          s = Math.max(0.8, Math.min(1, (truck ? len - 2.6 : len) / 13.8)),
          Lt = 13.805 * s,
          tr = M.trailer.clone(true);
        tr.scale.setScalar(s);
        const inner = new THREE.Group();
        inner.add(tr);
        if (truck) {
          const zf = -1.3;
          inner.add(tractor(i));
          tr.position.z = zf - Lt / 2;
          inner.position.z = -(1.45 + zf - Lt) / 2;
        }
        g = new THREE.Group();
        g.add(inner);
      } else {
        g = M.pickup.clone(true);
        recolor(g, CARC[i % CARC.length]);
        g.scale.set(0.74, 0.8, 0.84);
      }
      g.rotation.y = (-rot * Math.PI) / 180 + (l > w ? 0 : Math.PI / 2);
    }
    g.position.set(x, y0, z);
    G.vehicles.add(g);
    if (M && !(n === "Camion" || n.startsWith("Remorque"))) bayAt(x, z, g.rotation.y);
  });
  if (M)
    [
      [70.3, -33.4, 0.25],
      [71.3, -33.4, 0.1],
      [72.3, -33.4, -0.15],
    ].forEach(([x, z, r]) => {
      const b = M.bike.clone(true);
      b.position.set(x, 0, z);
      b.rotation.y = r;
      G.vehicles.add(b);
    });
}

cur = G.cranes;
const orange = mat(0xee8a2c),
  black = mat(0x2b2f33);
// portique de stockage : acier galvanisé (gris clair métallisé) ; les autres ponts roulants restent orange
const galv = mat(0xc4cdd5),
  isPortique = (x) => x > 100;
SITE.cranes.forEach((k) => {
  const [x, z, zb, L, W, H] = k,
    top = zb < 3.5 ? Math.min(zb + H, 2.75) : zb + H,
    m = isPortique(x) ? galv : orange;
  [-1, 1].forEach((s) => box(0.5, 0.6, L, m, x + (s * W) / 2, top - 0.3, z));
  box(W + 0.6, 0.8, 0.8, m, x, top + 0.2, z - L * 0.12);
  box(1.2, 0.8, 1.5, black, x, top - 0.55, z - L * 0.12);
});
// pieds du portique = « Potence colonne » Mavimplant : poteau galvanisé + bras jaune de 4,14 m sous le chemin de roulement.
// La position Mavimplant est le milieu du bras ; le poteau est au bout du bras, côté extérieur (rotation 0 → bras vers le sud, 180 → vers le nord).
const yellowP = mat(0xf2c230),
  redP = mat(0xc62828),
  plateM = mat(0x5b636b),
  ARM = 4.14;
const PPOSTS = SITE.posts
  .filter((p) => isPortique(p[0]))
  .map(([x, zm, rot]) => {
    const d = (rot === undefined ? zm < 0 : Math.abs(rot) < 90) ? 1 : -1;
    return { x, z: zm - d * (ARM / 2 - 0.2), zm, d };
  }); // poteau 20 cm en retrait du bout du bras
SITE.posts.filter((p) => !isPortique(p[0])).forEach((p) => box(0.4, 6.58, 0.4, orange, p[0], 3.29, p[1]));
PPOSTS.forEach(({ x, z, zm }) => {
  box(0.6, 0.05, 0.6, plateM, x, 0.025, z); // platine
  [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ].forEach(([dx, dz]) => box(0.05, 0.1, 0.05, plateM, x + dx, 0.08, z + dz)); // boulons
  box(0.3, 6.0, 0.3, galv, x, 3.0, z); // poteau
  box(0.45, 0.32, ARM + 0.3, yellowP, x, 6.12, zm); // bras de potence sous le chemin de roulement
  for (let k = -3; k <= 3; k++) box(0.02, 0.2, 0.12, redP, x + 0.235, 6.12, zm + k * 0.22); // bandes de signalisation
});
// croix de contreventement : travée du milieu (accès), sur les deux côtés du portique
const braceMat = mat(0xa9b3bb);
[...new Set(PPOSTS.map((p) => p.x.toFixed(2)))].map(Number).forEach((xs) => {
  const zs = PPOSTS.filter((p) => Math.abs(p.x - xs) < 0.05)
    .map((p) => p.z)
    .sort((a, b) => a - b);
  {
    const i = Math.floor((zs.length - 1) / 2); // travée du milieu (accès)
    [
      [0.35, 5.9],
      [5.9, 0.35],
    ].forEach(([y1, y2]) => {
      const dz = zs[i + 1] - zs[i],
        dy = y2 - y1,
        L = Math.hypot(dz, dy),
        m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, L), braceMat);
      m.position.set(xs, (y1 + y2) / 2, (zs[i] + zs[i + 1]) / 2);
      m.rotation.x = Math.atan2(-dy, dz);
      G.cranes.add(m);
    });
  }
});

/* ---------- Cantilevers ---------- */
const RACKS = {};
const steel = mat(0x3557c9);
const colG = new THREE.BoxGeometry(0.2, 5.75, 0.3),
  footG = new THREE.BoxGeometry(1.958, 0.3, 0.24),
  armG = new THREE.BoxGeometry(0.8, 0.07, 0.1),
  protG = new THREE.BoxGeometry(2.244, 0.3, 0.06);
["E", "M"].forEach((zn) =>
  RACK_X.forEach((x, t) => {
    const g = new THREE.Group(),
      z0 = ROW_Z[zn],
      M4 = new THREE.Matrix4();
    const colI = new THREE.InstancedMesh(colG, steel, 7),
      footI = new THREE.InstancedMesh(footG, steel, 7),
      armI = new THREE.InstancedMesh(armG, orange, 98),
      prI = new THREE.InstancedMesh(protG, mat(0xf2c230), 2);
    let ai = 0;
    COLS_Z.forEach((dz, i) => {
      M4.makeTranslation(x, 2.875, z0 + dz);
      colI.setMatrixAt(i, M4);
      M4.makeTranslation(x, 0.15, z0 + dz);
      footI.setMatrixAt(i, M4);
      for (let lv = 2; lv <= 8; lv++)
        [-1, 1].forEach((s) => {
          M4.makeTranslation(x + s * 0.5, levelY(lv) - 0.08, z0 + dz);
          armI.setMatrixAt(ai++, M4);
        });
    });
    // contreventements (vue de face) : lisses à 1 650 et 2 845 mm sur toute la longueur avec diagonales, à 4 110 et 5 300 mm dans les travées d'extrémité
    const brace = (y0, y1, za, zb) => {
      const len = Math.hypot(zb - za, y1 - y0),
        o = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), steel);
      o.position.set(x, (y0 + y1) / 2, z0 + (za + zb) / 2);
      o.rotation.x = -Math.atan2(y1 - y0, zb - za);
      g.add(o);
    };
    [1.65, 2.845].forEach((y) => brace(y, y, COLS_Z[0], COLS_Z[6]));
    for (let i = 0; i < 6; i++) brace(1.65, 2.845, COLS_Z[i], COLS_Z[i + 1]);
    [
      [0, 1],
      [5, 6],
    ].forEach(([a, b]) => {
      brace(4.11, 4.11, COLS_Z[a], COLS_Z[b]);
      brace(5.3, 5.3, COLS_Z[a], COLS_Z[b]);
      brace(4.11, 5.3, COLS_Z[a], COLS_Z[b]);
    });
    [-1, 1].forEach((sg, i) => {
      M4.makeTranslation(x, 0.2, z0 + sg * (CANT.len / 2 - 0.04));
      prI.setMatrixAt(i, M4);
    });
    [colI, footI, armI, prI].forEach((o) => g.add(o));
    scene.add(g);
    RACKS[zn + (t + 1)] = g;
  }),
);

/* ---------- Allées de circulation ---------- */
const LANE = 3.0,
  laneMat = new THREE.MeshLambertMaterial({ color: 0xf3d36b, transparent: true, opacity: 0.62, depthWrite: false }),
  arrowMat = new THREE.MeshBasicMaterial({ color: 0x5b6168, transparent: true, opacity: 0.85, depthWrite: false });
const arrowGeo = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-0.7, -0.18);
  sh.lineTo(0.15, -0.18);
  sh.lineTo(0.15, -0.45);
  sh.lineTo(0.75, 0);
  sh.lineTo(0.15, 0.45);
  sh.lineTo(0.15, 0.18);
  sh.lineTo(-0.7, 0.18);
  sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  return g;
})();
const LANES = [];
function lane(x0, z0, x1, z1) {
  // allée de 3 m, sens de circulation de (x0, z0) vers (x1, z1)
  const len = Math.hypot(x1 - x0, z1 - z0),
    ang = Math.atan2(-(z1 - z0), x1 - x0);
  const o = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, LANE), laneMat);
  o.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  o.rotation.y = ang;
  G.ground.add(o);
  const n = Math.max(1, Math.floor(len / 4.5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n,
      a = new THREE.Mesh(arrowGeo, arrowMat);
    a.position.set(x0 + (x1 - x0) * t, 0.03, z0 + (z1 - z0) * t);
    a.rotation.y = ang;
    G.ground.add(a);
  }
  LANES.push([x0, z0, x1, z1]);
}
const laneGeom = (zn) => {
  const z0 = ROW_Z[zn],
    zN = z0 - CANT.len / 2,
    zS = z0 + CANT.len / 2,
    xW = RACK_X[0] - CANT.base / 2 - LANE / 2,
    xE = RACK_X[3] + CANT.base / 2 + LANE / 2,
    zL = zS + LANE / 2;
  return { zN, zS, xW, xE, zL };
};
["E", "M"].forEach((zn) => {
  const { zN, zS, xW, xE, zL } = laneGeom(zn);
  lane(xE, zN, xE, zL + LANE / 2);
  lane(xE + LANE / 2, zL, xW - LANE / 2, zL);
  lane(xW, zL - LANE / 2, xW, zN); // boucle : est vers le sud, sud vers l'ouest, ouest vers le nord
  for (let i = 0; i < 3; i++) {
    const xa = (RACK_X[i] + RACK_X[i + 1]) / 2;
    lane(xa, zN, xa, zS);
  }
}); // allées entre racks

/* ---------- Emprise des racks ---------- */
cur = G.ground;
["E", "M"].forEach((zn) =>
  RACK_X.forEach((x) => {
    const z0 = ROW_Z[zn];
    [-1, 1].forEach((s2) => {
      box(CANT.base, 0.016, 0.08, mat(0xf2c230), x, 0.03, z0 + (s2 * CANT.len) / 2);
      box(0.08, 0.016, CANT.len, mat(0xf2c230), x + (s2 * CANT.base) / 2, 0.03, z0);
    });
  }),
);

/* ---------- Portique ---------- */
cur = G.ground;
const yl = mat(0xf2c230),
  wl = mat(0xffffff),
  pileFloor = mat(0xe9e2c4);
for (let i = 1; i <= POR.n; i++) {
  const zc = porZ(i),
    xc = POR.x0 + POR.w / 2;
  box(POR.w, 0.01, POR.pile, pileFloor, xc, 0.025, zc);
  [-1, 1].forEach((sg) => box(POR.w, 0.015, 0.08, yl, xc, 0.035, zc + (sg * POR.pile) / 2));
  if (i < POR.n && i !== POR.n1) {
    const za = zc - POR.pitch / 2;
    for (let x = POR.x0 + 0.6; x < POR.x0 + POR.w - 0.6; x += 1.6) box(0.8, 0.015, 0.08, wl, x + 0.4, 0.033, za);
  }
}
[
  [POR.zs, porZ(POR.n1) - POR.pile / 2],
  [POR.bandN, porZ(POR.n) - POR.pile / 2],
].forEach(([a, b]) =>
  [POR.x0 + 0.06, POR.x0 + POR.w - 0.06].forEach((x) => box(0.12, 0.015, a - b, yl, x, 0.035, (a + b) / 2)),
);
// zone camion et voie ferrée, avec 1 m de sécurité de chaque côté : à laisser libre
box(
  POR.w,
  0.008,
  POR.bandS - POR.bandN,
  new THREE.MeshLambertMaterial({ color: 0xf3c9c9, transparent: true, opacity: 0.55, depthWrite: false }),
  POR.x0 + POR.w / 2,
  0.02,
  (POR.bandS + POR.bandN) / 2,
);
[POR.bandN, POR.bandS].forEach((z) => box(POR.w, 0.016, 0.12, mat(0xd64545), POR.x0 + POR.w / 2, 0.036, z));
const supI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), mat(0xd9b64a), POR.n * 4),
  S4 = new THREE.Matrix4();
for (let i = 0; i < POR.n; i++)
  [-5.4, -1.8, 1.8, 5.4].forEach((dx, k) => {
    S4.makeTranslation(POR.x0 + POR.w / 2 + dx, 0.06, porZ(i + 1));
    supI.setMatrixAt(i * 4 + k, S4);
  });
cur.add(supI);
// ranchers : barres verticales de 50 cm, 5 de chaque côté de chaque pile, comme sur un camion plateau
const STK = [-7, -3.5, 0, 3.5, 7],
  stakeI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), mat(0x7d8790), POR.n * 10),
  capI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.05, 0.075), mat(0xf2c230), POR.n * 10);
let si = 0;
for (let i = 1; i <= POR.n; i++)
  STK.forEach((dx) =>
    [-1, 1].forEach((sg) => {
      const x = POR.x0 + POR.w / 2 + dx,
        z = porZ(i) + sg * (POR.pile / 2 - 0.04);
      S4.makeTranslation(x, 0.31, z);
      stakeI.setMatrixAt(si, S4);
      S4.makeTranslation(x, 0.645, z);
      capI.setMatrixAt(si, S4);
      si++;
    }),
  );
cur.add(stakeI, capI);

/* ---------- Fardeaux ---------- */
const hOf = (z, per) =>
  z === "P" ? Math.max(0.12, Math.min(0.9, 0.08 + per * 0.004)) : Math.max(0.09, Math.min(0.5, 0.06 + per * 0.0028));
function slotGeom(z, s, r, h) {
  if (z === "P") return { w: r ? r.l : 15, d: POR.pile - 0.14, x: POR.x0 + POR.w / 2, y: 0.12 + h / 2, zz: porZ(s) }; // fagot tenu entre les ranchers
  const k = cantSlot(s);
  return {
    w: 0.62,
    d: r ? r.l : 6,
    x: RACK_X[k.t - 1] + (k.face === "A" ? -0.5 : 0.5),
    y: levelY(k.lv) + h / 2,
    zz: ROW_Z[z],
  };
}
const bundles = [];
function placeMesh(o) {
  const p = o.userData.p,
    per = Math.ceil(p.r.b / Math.max(1, p.r.n)),
    h = hOf(p.z, per),
    g = slotGeom(p.z, p.s, p.r, h);
  o.geometry.dispose();
  o.geometry = new THREE.BoxGeometry(g.w, h, g.d);
  o.position.set(g.x, g.y, g.zz);
  o.userData.per = per;
}
function addMesh(p) {
  const o = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: KCOL[p.r.k], transparent: true }),
  );
  o.userData.p = p;
  placeMesh(o);
  G.charges.add(o);
  bundles.push(o);
  return o;
}
function removeMesh(p) {
  const i = bundles.findIndex((b) => b.userData.p === p);
  if (i < 0) return;
  G.charges.remove(bundles[i]);
  bundles[i].geometry.dispose();
  bundles.splice(i, 1);
}
PIECES.forEach(addMesh);
const freeMeshes = [];
const freeMat = new THREE.MeshBasicMaterial({ color: 0x8c98a3, transparent: true, opacity: 0.18, depthWrite: false }),
  freeOk = new THREE.MeshBasicMaterial({ color: 0x2f9e44, transparent: true, opacity: 0.45, depthWrite: false });
const edgeM = new THREE.LineBasicMaterial({ color: 0x8c98a3, transparent: true, opacity: 0.6 });
function rebuildFree() {
  freeMeshes.forEach((m) => G.free.remove(m));
  freeMeshes.length = 0;
  const occ = occupied();
  ["P", "M", "E"].forEach((z) => {
    for (let s = 1; s <= CAP[z]; s++) {
      if (occ[z].has(s)) continue;
      const g = slotGeom(z, s, null, 0.16),
        m = new THREE.Mesh(new THREE.BoxGeometry(g.w, 0.16, g.d), freeMat);
      m.position.set(g.x, g.y, g.zz);
      m.userData = { free: true, z, s };
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), edgeM));
      G.free.add(m);
      freeMeshes.push(m);
    }
  });
}
rebuildFree();

/* ---------- Étiquettes ---------- */
function label(text, x, y, z, size = 1.6, grp) {
  const c = document.createElement("canvas"),
    g = c.getContext("2d"),
    px = 64;
  g.font = `700 ${px}px Calibri, Carlito, Arial`;
  const w = Math.ceil(g.measureText(text).width) + 30;
  c.width = w;
  c.height = px + 24;
  g.font = `700 ${px}px Calibri, Carlito, Arial`;
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.fillRect(0, 0, w, c.height);
  g.fillStyle = "#1E2A34";
  g.textBaseline = "middle";
  g.fillText(text, 15, c.height / 2 + 2);
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, fog: false }),
  );
  sp.scale.set((size * w) / c.height, size, 1);
  sp.position.set(x, y, z);
  sp.renderOrder = 5;
  sp.userData.base = [sp.scale.x, sp.scale.y];
  (grp || G.labels).add(sp);
}
const dimMat = new THREE.LineBasicMaterial({ color: 0x13202b, depthTest: false, transparent: true });
let ELEV = false; // cotes d’élévation : visibles en 3D seulement
const tagC = () => {
  const k = G.cotes.children;
  for (let i = k.length - 1; i >= 0 && k[i].userData.tag !== 1; i--) {
    k[i].userData.tag = 1;
    k[i].userData.elev = ELEV;
  }
};
const mm = (v) =>
  Math.round(v * 1000)
    .toLocaleString("fr-FR")
    .replace(/[\u202f\u00a0]/g, " ");
function dim(a, b, off, y = 0.06, txt, size = 0.5) {
  // cote au sol : a, b = [x, z], off = décalage [dx, dz] de la ligne de cote
  const A = [a[0] + off[0], a[1] + off[1]],
    B = [b[0] + off[0], b[1] + off[1]],
    L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1,
    ux = (B[0] - A[0]) / L,
    uz = (B[1] - A[1]) / L,
    t = 0.18;
  const P = [
    A[0],
    y,
    A[1],
    B[0],
    y,
    B[1],
    a[0],
    y,
    a[1],
    A[0],
    y,
    A[1],
    b[0],
    y,
    b[1],
    B[0],
    y,
    B[1],
    A[0] - (ux + uz) * t,
    y,
    A[1] - (uz - ux) * t,
    A[0] + (ux + uz) * t,
    y,
    A[1] + (uz - ux) * t,
    B[0] - (ux + uz) * t,
    y,
    B[1] - (uz - ux) * t,
    B[0] + (ux + uz) * t,
    y,
    B[1] + (uz - ux) * t,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  const l = new THREE.LineSegments(g, dimMat);
  l.renderOrder = 6;
  G.cotes.add(l);
  label(txt || mm(L), (A[0] + B[0]) / 2, y + 0.35, (A[1] + B[1]) / 2, size, G.cotes);
  tagC();
}
function dimV(x, z, y0, y1, txt, size = 0.5, dx = 0.35) {
  // cote verticale (hauteurs)
  const P = [x, y0, z, x, y1, z, x - 0.15, y0, z, x + 0.15, y0, z, x - 0.15, y1, z, x + 0.15, y1, z],
    g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  const l = new THREE.LineSegments(g, dimMat);
  l.renderOrder = 6;
  G.cotes.add(l);
  label(txt || mm(y1 - y0), x + dx, (y0 + y1) / 2, z, size, G.cotes);
  tagC();
}
function makeCotes() {
  G.cotes.clear();
  // racks et allées entre racks : plan fournisseur
  ["E", "M"].forEach((zn) => {
    const z0 = ROW_Z[zn],
      zs = z0 + CANT.len / 2,
      zn0 = z0 - CANT.len / 2;
    RACK_X.forEach((x, i) => {
      dim([x - CANT.base / 2, zs], [x + CANT.base / 2, zs], [0, 0.9]);
      if (i < 3) dim([x + CANT.base / 2, zs], [RACK_X[i + 1] - CANT.base / 2, zs], [0, 0.9]);
    });
    dim([RACK_X[0] - CANT.base / 2, zn0], [RACK_X[0] - CANT.base / 2, zs], [-1.0, 0]);
    const L = laneGeom(zn);
    dim([L.xW - LANE / 2, zs], [L.xW + LANE / 2, zs], [0, 0.9]);
    dim([L.xE - LANE / 2, zs], [L.xE + LANE / 2, zs], [0, 0.9]);
    dim([CANT.xLimit, zs], [CANT.xLimit + 1.0, zs], [0, 0.9], 0.06, "1 000");
  }); // recul de 1 m entre l’allée est et le portique
  // élévation d'un rack (milieu T1) d'après les vues de face et de profil du fournisseur
  ELEV = true;
  const rx = RACK_X[0],
    ze = ROW_Z.M - CANT.len / 2 - 0.45;
  dimV(rx - 1.25, ze, 0, 5.75);
  dimV(rx - 2.05, ze, 0, levelY(8) - 0.04, "dernier niveau " + mm(levelY(8) - 0.04), 0.45, 1.25);
  dimV(rx - 1.25, ze + 0.2, levelY(7) - 0.04 + 0.094, levelY(8) - 0.04 - 0.0001, "600 utiles", 0.42, 0.85);
  dimV(rx + 1.3, ze, 0, 0.3, "pied 300", 0.4, 0.75);
  [
    [rx - 0.1, rx - 0.9],
    [rx + 0.1, rx + 0.9],
  ].forEach(([a, b]) => {
    const y = levelY(8) + 0.25;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([a, y, ze + 0.45, b, y, ze + 0.45], 3));
    G.cotes.add(new THREE.LineSegments(g, dimMat));
    label("800", (a + b) / 2, y + 0.3, ze + 0.45, 0.42, G.cotes);
  });
  dim([rx, ROW_Z.M + COLS_Z[0]], [rx, ROW_Z.M + COLS_Z[1]], [0, 0], 5.95, "950", 0.42);
  tagC();
  ELEV = false;
  // cotes du plan 2D Mavimplant (sauf celles qui mesurent un rack, remplacées par les dimensions du fournisseur)
  (SITE.rulers || []).forEach((pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1],
        L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (pts.length === 2 && (Math.abs(L - 3.94) < 0.02 || Math.abs(L - 6.0) < 0.02)) continue;
      dim(a, b, [0, 0], 0.08, mm(L), L > 20 ? 0.7 : 0.55);
    }
  });
  // emplacements sous le portique : pile et allée
  dim([POR.x0 + POR.w, POR.zs], [POR.x0 + POR.w, POR.zs - POR.pile], [0.8, 0], 0.06, "500", 0.42);
  dim([POR.x0 + POR.w, POR.zs - POR.pile], [POR.x0 + POR.w, POR.zs - POR.pitch], [0.8, 0], 0.06, "800", 0.42);
}
function makeLabels() {
  G.labels.clear();
  makeCotes();
  label("Cantilevers zone Est", 93.3, 0.9, ROW_Z.E - 4.6, 1.1);
  label("Cantilevers zone milieu", 93.3, 0.9, ROW_Z.M + 4.6, 1.1);
  label("Stockage au sol sous le portique", POR.x0 + POR.w / 2, 9.4, porZ(31) - 2, 1.2);
  ["E", "M"].forEach((zn) => RACK_X.forEach((x, t) => label("T" + (t + 1), x, 6.3, ROW_Z[zn], 0.8)));
  label("POR-001", POR.x0 - 1.6, 0.8, porZ(1), 0.7);
  label("POR-007", POR.x0 - 1.6, 0.8, porZ(7), 0.7);
  label("POR-008", POR.x0 - 1.6, 0.8, porZ(8), 0.7);
  label("POR-031", POR.x0 - 1.6, 0.8, porZ(31), 0.7);
  label("zone camion et voie ferrée + 1 m de sécurité", POR.x0 + POR.w + 3.6, 0.9, (POR.bandS + POR.bandN) / 2, 0.6);
  label("zone verte à laisser libre", POR.x0 + POR.w / 2, 0.6, POR.zs + 1.1, 0.6);

  label("Sol à refaire (environ 2 040 m²)", 76, 0.7, -15.8, 0.9);
}

/* ---------- Filtres et indicateurs ---------- */
const fN = $("fN");
for (let i = 1; i <= 8; i++)
  fN.insertAdjacentHTML("beforeend", `<option value="${i}">Niveau ${i}${i === 1 ? " (sur les pieds)" : ""}</option>`);
const refreshCodes = () => {
  // listes déroulantes de références (filtres, plan de rangement, stock)
  const e = (v) =>
    String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  const opts = REFS.slice()
    .sort((a, b) => a.c.localeCompare(b.c))
    .map((r) => `<option value="${e(r.c)}">${e(r.c)} · ${e(r.d)}</option>`)
    .join("");
  [
    ["fS", "Toutes les références"],
    ["planSearch", "Toutes les références"],
    ["stSearch", "Toutes les références"],
  ].forEach(([id, all]) => {
    const el = $(id);
    if (!el) return;
    const v = el.value;
    el.innerHTML = `<option value="">${all}</option>` + opts;
    el.value = v;
  });
};
refreshCodes();
let selected = null,
  selPiece = null,
  moving = null;
const hiddenRacks = new Set(
  MODE ? (saved && saved.hidden) || [] : IN_CLAUDE ? [] : (saved && saved.hidden) || store.get("at1-hidden") || [],
);
const selGroup = new THREE.Group();
scene.add(selGroup);
const selMat = new THREE.LineBasicMaterial({ color: 0xff2d2d, depthTest: false, transparent: true });
const rackOf = (p) => (p.z === "P" ? null : p.z + cantSlot(p.s).t);
function matches(p) {
  const z = $("fZone").value,
    k = $("fK").value,
    l = $("fL").value,
    n = $("fN").value;
  if (z && p.z !== z) return false;
  if (k && p.r.k !== k) return false;
  if (l && String(p.r.l) !== l) return false;
  if (n && (p.z === "P" || cantSlot(p.s).lv !== +n)) return false;
  return true;
}
function apply() {
  const shown = new Set(),
    z = $("fZone").value,
    n = $("fN").value;
  bundles.forEach((o) => {
    const p = o.userData.p,
      ok = matches(p),
      isSel = selected && p.r.c === selected;
    o.visible = !(rackOf(p) && hiddenRacks.has(rackOf(p)));
    o.material.color.set(ok || isSel ? colorOf(p.r) : "#B8C1C9");
    o.material.opacity = ok || isSel ? 1 : 0.22;
    o.material.emissive = new THREE.Color(isSel ? 0x553300 : 0x000000);
    if (ok) shown.add(p.r.c);
  });
  freeMeshes.forEach((m) => {
    const u = m.userData,
      rk = u.z === "P" ? null : u.z + cantSlot(u.s).t;
    m.visible = (!z || u.z === z) && (!n || (u.z !== "P" && cantSlot(u.s).lv === +n)) && !(rk && hiddenRacks.has(rk));
    m.material = moving && okIn(moving.r, u.z) ? freeOk : freeMat;
  });
  Object.entries(RACKS).forEach(([k, g]) => (g.visible = !hiddenRacks.has(k)));
  const rs = REFS.filter((r) => shown.has(r.c));
  renderKpis(rs);
  renderBars(rs);
  renderDonut(z);
  renderMoves();
}
const hiddenOf = (zn) => [1, 2, 3, 4].filter((t) => hiddenRacks.has(zn + t)).length;
const capZone = (zn) => (zn === "P" ? CAP.P : CAP[zn] - 16 * hiddenOf(zn)); // un cantilever masqué = 16 emplacements retirés
const inHiddenRack = (p) => !!(rackOf(p) && hiddenRacks.has(rackOf(p)));
const slotsUsed = (zn) => PIECES.filter((p) => p.z === zn && !inHiddenRack(p)).length;
const pct = (u, c) => (c > 0 ? Math.round((u / c) * 100) : 0);
function renderKpis(rs) {
  const t = rs.reduce((a, r) => a + r.w, 0) / 1000,
    pc = (zn) => pct(slotsUsed(zn), capZone(zn)),
    occ = (zn) => `${slotsUsed(zn)} / ${capZone(zn)}`,
    nr = (zn) => 4 - hiddenOf(zn);
  $("kpis").innerHTML =
    `<div class="kpi t"><div class="v">${rs.length}</div><div class="l">références affichées sur ${REFS.length}, ${fr(t)} t</div></div>
    <div class="kpi p"><div class="v" style="color:${occCol(pc("P"))}">${occ("P")}</div><div class="l">emplacements sous le portique</div></div>
    <div class="kpi m"><div class="v" style="color:${occCol(pc("M"))}">${pc("M")} %</div><div class="l">cantilevers milieu, ${occ("M")} emplacements, ${nr("M")} rack${nr("M") > 1 ? "s" : ""}</div></div>
    <div class="kpi e"><div class="v" style="color:${occCol(pc("E"))}">${pc("E")} %</div><div class="l">cantilevers Est, ${occ("E")} emplacements, ${nr("E")} rack${nr("E") > 1 ? "s" : ""}</div></div>`;
}
function renderBars(rs) {
  if (typeof STOCKS !== "undefined" && STOCKS.colorMode === "stock") {
    // couleur des fardeaux = statut du stock
    $("barsTitle").textContent = "Références par statut du stock";
    recompute();
    const ks = ["R", "C", "O", "N", "S"],
      cnt = ks.map((k) => rs.filter((r) => STOCK0[r.c] && statusOf(r.c, LEVELS[r.c] ?? STOCK0[r.c].q) === k).length),
      mx = Math.max(1, ...cnt);
    $("bars").innerHTML = ks
      .map(
        (k, i) =>
          `<div class="row"><span>${STAT[k].lab}</span><div class="track"><div class="fill" style="width:${(cnt[i] / mx) * 100}%;background:${STAT[k].col}"></div></div><span class="n">${cnt[i]}</span></div>`,
      )
      .join("");
    return;
  }
  $("barsTitle").textContent = "Références par classe";
  const ks = ["A", "B", "C", "Sans historique"],
    cnt = ks.map((k) => rs.filter((r) => r.k === k).length),
    mx = Math.max(1, ...cnt);
  $("bars").innerHTML = ks
    .map(
      (k, i) =>
        `<div class="row"><span>${KLAB[k]}</span><div class="track"><div class="fill" style="width:${(cnt[i] / mx) * 100}%;background:${KCOL[k]}"></div></div><span class="n">${cnt[i]}</span></div>`,
    )
    .join("");
}
function renderDonut(z) {
  const zs = z ? [z] : ["P", "M", "E"],
    cap = zs.reduce((a, x) => a + capZone(x), 0),
    u = zs.reduce((a, x) => a + slotsUsed(x), 0),
    f = Math.max(0, cap - u),
    C = 2 * Math.PI * 42,
    pc = pct(u, cap),
    a = Math.min(1, cap ? u / cap : 0) * C,
    col = occCol(pc);
  $("donut").innerHTML =
    `<svg viewBox="0 0 110 110" role="img" aria-label="${u} emplacements occupés sur ${cap}"><circle cx="55" cy="55" r="42" fill="none" stroke="var(--line)" stroke-width="16"/>
    <circle cx="55" cy="55" r="42" fill="none" stroke="${col}" stroke-width="16" stroke-dasharray="${a} ${C - a}" transform="rotate(-90 55 55)"/>
    <text x="55" y="53" text-anchor="middle" font-family="Calibri, Carlito, Arial" font-weight="700" font-size="22" fill="var(--ink)">${pc} %</text><text x="55" y="70" text-anchor="middle" font-size="10" fill="var(--muted)">occupés</text></svg>
    <div class="legend"><div><span class="sw" style="background:${col}"></span>${u} occupés</div><div><span class="sw" style="background:var(--line)"></span>${f} libres</div><div style="color:var(--muted)">${z ? ZLAB[z] : "Toutes les zones"}</div></div>`;
  const hid = PIECES.filter(inHiddenRack).length,
    racks = 8 - hiddenRacks.size;
  $("occBars").innerHTML =
    ["P", "M", "E"]
      .map((x) => {
        const p = pct(slotsUsed(x), capZone(x));
        return `<div class="row"><span>${{ P: "Portique", M: "Milieu", E: "Est" }[x]}</span><div class="track"><div class="fill" style="width:${Math.min(100, p)}%;background:${occCol(p)}"></div></div><span class="n">${p} %</span></div>`;
      })
      .join("") +
    (hid
      ? `<p class="note" style="color:#E03131;font-weight:600">${hid} fardeau${hid > 1 ? "x restent" : " reste"} dans un cantilever masqué : déplacez-le${hid > 1 ? "s" : ""} vers un autre emplacement.</p>`
      : "");
}
// légende de la maquette : renderLegend() (classe ABC ou statut du stock)
["fZone", "fK", "fL", "fN"].forEach((id) => $(id).addEventListener("change", apply));
$("fS").addEventListener("change", () => {
  const r = REFS.find((x) => x.c === $("fS").value);
  if (r) select(r.c, null, true);
});
$("reset").addEventListener("click", () => {
  ["fZone", "fK", "fL", "fN", "fS"].forEach((id) => ($(id).value = ""));
  select(null);
});

/* ---------- Éléments affichés ---------- */
document.querySelectorAll("[data-layer]").forEach((c) => {
  const k = c.dataset.layer,
    saved = (store.get("at1-layers") || {})[k];
  if (saved === false) {
    c.checked = false;
    G[k].visible = false;
  }
  c.addEventListener("change", () => {
    G[k].visible = c.checked;
    const all = store.get("at1-layers") || {};
    all[k] = c.checked;
    store.set("at1-layers", all);
  });
});
$("rackBtns").innerHTML = ["M", "E"]
  .map(
    (zn) =>
      `<span>${zn === "M" ? "Milieu" : "Est"}</span>` +
      [1, 2, 3, 4]
        .map(
          (t) =>
            `<button type="button" data-rack="${zn + t}" aria-pressed="${!hiddenRacks.has(zn + t)}">T${t}</button>`,
        )
        .join(""),
  )
  .join("");
document.querySelectorAll("[data-rack]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!canEditPlan()) return;
    const k = b.dataset.rack;
    hiddenRacks.has(k) ? hiddenRacks.delete(k) : hiddenRacks.add(k);
    b.setAttribute("aria-pressed", String(!hiddenRacks.has(k)));
    if (!MODE) store.set("at1-hidden", [...hiddenRacks]);
    save();
    apply();
    const n = PIECES.filter((p) => rackOf(p) === k).length,
      nom = (k[0] === "M" ? "milieu" : "Est") + " T" + k[1];
    if (hiddenRacks.has(k))
      banner(
        n
          ? `Cantilever ${nom} masqué : il contient encore ${n} fardeau${n > 1 ? "x" : ""}, à déplacer avant de le retirer. Les taux d’occupation sont recalculés sans ce cantilever.`
          : `Cantilever ${nom} retiré : les taux d’occupation sont recalculés sans ses 16 emplacements.`,
      );
    else banner(`Cantilever ${nom} remis en place.`);
    setTimeout(() => {
      if (!moving) banner("");
    }, 4500);
  }),
);

/* ---------- Fiche d’une référence ---------- */
function select(code, piece, fly) {
  selected = code;
  selPiece = piece || (code ? piecesOf(code)[0] : null);
  const info = $("info");
  selGroup.clear();
  if (!code) {
    info.classList.remove("open");
    apply();
    if (typeof renderTable === "function") renderTable();
    return;
  }
  if (fly) ["fZone", "fK", "fL", "fN"].forEach((id) => ($(id).value = ""));
  const r = REFS.find((x) => x.c === code),
    ps = piecesOf(code),
    per = Math.ceil(r.b / Math.max(1, r.n));
  info.innerHTML = `<h3>${r.c} <span class="tag" style="background:${KCOL[r.k]}">${KLAB[r.k]}</span><button class="close" type="button" aria-label="Fermer">×</button></h3>
    <dl><dt>Désignation</dt><dd>${r.d}</dd><dt>Longueur</dt><dd>${r.l} m</dd><dt>Zone</dt><dd>${[...new Set(ps.map((p) => ZLAB[p.z]))].join(", ")}</dd>
    <dt>${ps.length > 1 ? "Adresses" : "Adresse"}</dt><dd>${ps.map((p) => addr(p.z, p.s)).join(", ")}</dd>
    <dt>Barres à ranger</dt><dd>${per}${r.n > 1 ? ` par emplacement (${r.b} au total, sur ${r.n} emplacements)` : ""}</dd>
    ${STOCK0[r.c] ? `<dt>Stock</dt><dd>${stockLine(r.c)}</dd>` : ""}
    <dt>Charge</dt><dd>${fr(r.w / Math.max(1, ps.length))} kg par emplacement</dd><dt>Poids total</dt><dd>${fr(r.w)} kg</dd></dl>
    <button class="btn primary" type="button" id="moveBtn">Déplacer ${ps.length > 1 ? "l’emplacement " + addr(selPiece.z, selPiece.s) : "cette référence"}</button>`;
  info.classList.add("open");
  info.querySelector(".close").addEventListener("click", () => select(null));
  $("moveBtn").addEventListener("click", () => startMove(selPiece));
  bundles
    .filter((b) => b.userData.p.r.c === code)
    .forEach((b) => {
      const q = b.geometry.parameters,
        l = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(q.width + 0.12, q.height + 0.12, q.depth + 0.12)),
          selMat,
        );
      l.position.copy(b.position);
      l.renderOrder = 6;
      selGroup.add(l);
    });
  apply();
  if (typeof renderTable === "function") {
    renderTable();
    const tr = document.querySelector(`#planBody tr[data-c="${CSS.escape(code)}"]`),
      sc = document.querySelector(".plan .scroll");
    if (tr && sc) {
      const d = tr.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      if (d < 40 || d > sc.clientHeight - 40) sc.scrollTop += d - sc.clientHeight / 2;
    }
  }
  if (fly) {
    const o = bundles.find((b) => b.userData.p === selPiece);
    if (o) focusOn(o, selPiece);
  }
}
function ask(title, html, okTxt = "Valider") {
  return new Promise((res) => {
    const m = $("confirm");
    $("cTitle").textContent = title;
    $("cText").innerHTML = html;
    $("cOk").textContent = okTxt;
    m.hidden = false;
    $("cOk").focus();
    const done = (v) => {
      m.hidden = true;
      $("cOk").onclick = $("cCancel").onclick = null;
      document.removeEventListener("keydown", key);
      res(v);
    };
    const key = (e) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    $("cOk").onclick = () => done(true);
    $("cCancel").onclick = () => done(false);
    document.addEventListener("keydown", key);
  });
}
function banner(txt) {
  $("bannerTxt").textContent = txt;
  $("banner").classList.toggle("on", !!txt);
  $("bannerCancel").style.display = moving ? "" : "none";
}
function startMove(p) {
  if (!canEditPlan()) return;
  moving = p;
  banner(
    `Déplacement de ${p.r.c} (${addr(p.z, p.s)}) : touchez un emplacement libre en vert, ou un autre fardeau pour échanger.`,
  );
  G.free.visible = true;
  apply();
}
function stopMove(msg) {
  moving = null;
  banner(msg || "");
  apply();
  if (msg)
    setTimeout(() => {
      if (!moving) banner("");
    }, 3500);
}
$("bannerCancel").addEventListener("click", () => stopMove());
const saveMoves = save;
function refreshAfterMove(list, msg) {
  list.forEach((p) => placeMesh(bundles.find((b) => b.userData.p === p)));
  rebuildFree();
  saveMoves();
  const p = list[0];
  stopMove(msg);
  select(p.r.c, p);
  renderTable();
}
async function tryTarget(hit) {
  const p = moving;
  if (hit.userData.free) {
    const z = hit.userData.z,
      s = hit.userData.s;
    if (!okIn(p.r, z))
      return stopMove(
        `Une barre de ${p.r.l} m ne peut pas aller dans un cantilever : il est prévu pour des barres de 6 m.`,
      );
    const from = addr(p.z, p.s);
    if (
      !(await ask(
        "Confirmer le déplacement",
        `Déplacer <b>${p.r.c}</b> (${esc(p.r.d)})<br>de <b>${from}</b> vers <b>${addr(z, s)}</b> ?`,
      ))
    )
      return stopMove("Déplacement annulé.");
    p.z = z;
    p.s = s;
    return refreshAfterMove([p], `${p.r.c} déplacé de ${from} vers ${addr(z, s)}.`);
  }
  const q = hit.userData.p;
  if (!q || q === p) return stopMove();
  if (!okIn(p.r, q.z) || !okIn(q.r, p.z))
    return stopMove("Échange impossible : une barre de plus de 6 m ne peut pas aller dans un cantilever.");
  const a = addr(p.z, p.s),
    b = addr(q.z, q.s);
  if (!(await ask("Confirmer l’échange", `Échanger <b>${p.r.c}</b> (${a})<br>avec <b>${q.r.c}</b> (${b}) ?`)))
    return stopMove("Échange annulé.");
  [p.z, q.z] = [q.z, p.z];
  [p.s, q.s] = [q.s, p.s];
  refreshAfterMove([p, q], `${p.r.c} (${a}) et ${q.r.c} (${b}) échangés.`);
}
function changes() {
  const out = [];
  REFS.forEach((r) => {
    const o = ORIG[r.c];
    if (!o) {
      out.push({
        t: "Ajout",
        c: r.c,
        d: r.d,
        txt: `ajoutée en ${piecesOf(r.c)
          .map((p) => addr(p.z, p.s))
          .join(", ")}`,
      });
      return;
    }
    const diff = ["d", "l", "k", "b", "w"].filter((f) => String(o[f]) !== String(r[f]));
    if (diff.length)
      out.push({
        t: "Modification",
        c: r.c,
        d: r.d,
        txt:
          "modifiée (" +
          diff.map((f) => ({ d: "désignation", l: "longueur", k: "classe", b: "barres", w: "poids" })[f]).join(", ") +
          ")",
      });
  });
  PIECES.forEach((p) => {
    const o = ORIGPOS[p.id];
    if (o && (o.z !== p.z || o.s !== p.s))
      out.push({ t: "Déplacement", c: p.r.c, d: p.r.d, txt: `${addr(o.z, o.s)} → ${addr(p.z, p.s)}` });
  });
  Object.keys(ORIG).forEach((c) => {
    if (!REFS.find((r) => r.c === c)) out.push({ t: "Suppression", c, d: ORIG[c].d, txt: "supprimée" });
  });
  return out;
}
const movedList = changes;
function renderMoves() {
  const m = changes();
  $("movesNote").textContent = m.length ? "" : "Aucune modification.";
  $("movesList").innerHTML =
    m
      .slice(0, 12)
      .map((x) => `<li>${x.c} : ${x.txt}</li>`)
      .join("") + (m.length > 12 ? `<li>et ${m.length - 12} autres</li>` : "");
}
$("undoMoves").addEventListener("click", async () => {
  if (ROLE === "local") {
    store.set(DRAFT_KEY, MODE === "edition" ? { ...FILE_STATE, v: 1, hidden: [] } : null);
    if (!MODE) store.set("at1-hidden", []);
    location.reload();
    return;
  }
  if (ROLE === "editor" && DOC) {
    try {
      await DOC.delete();
    } catch (e) {
      planMsg("Réinitialisation refusée.", true);
    }
  }
});
$("copyMoves").addEventListener("click", () => {
  const txt =
    changes()
      .map((x) => `${x.t}\t${x.c}\t${x.d}\t${x.txt}`)
      .join("\n") || "Aucune modification";
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
    .then(() => {})
    .catch(() => banner("Copie impossible sur cet appareil."));
  setTimeout(() => banner(""), 3000);
});

/* ---------- Plan de rangement ---------- */
const zoneOrder = { P: 0, M: 1, E: 2 };
let editing = null,
  delAsk = null;
const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function planMsg(t, err) {
  const m = $("planMsg");
  m.textContent = t;
  m.classList.toggle("err", !!err);
  clearTimeout(planMsg.t);
  planMsg.t = setTimeout(() => {
    m.textContent = "";
  }, 5000);
}
function freeSlots(len, onlyVisible = true) {
  const occ = occupied(),
    out = [];
  ["P", "M", "E"].forEach((z) => {
    if (z !== "P" && len > 6) return;
    for (let s = 1; s <= CAP[z]; s++) {
      if (occ[z].has(s)) continue;
      if (onlyVisible && z !== "P" && hiddenRacks.has(z + cantSlot(s).t)) continue;
      out.push({ z, s });
    }
  });
  return out;
}
function autoSlots(len, n) {
  let list = freeSlots(len);
  if (len <= 6) {
    const zs = ["M", "E"].sort((a, b) => pct(slotsUsed(a), capZone(a)) - pct(slotsUsed(b), capZone(b)));
    list = list
      .filter((x) => x.z !== "P")
      .sort((a, b) => zs.indexOf(a.z) - zs.indexOf(b.z) || a.s - b.s)
      .concat(list.filter((x) => x.z === "P"));
  }
  return list.length >= n ? list.slice(0, n) : null;
}
function renderTable() {
  const q = $("planSearch").value.trim().toLowerCase();
  const rows = REFS.map((r) => ({ r, ps: piecesOf(r.c).sort((a, b) => zoneOrder[a.z] - zoneOrder[b.z] || a.s - b.s) }))
    .sort((a, b) => {
      const x = a.ps[0],
        y = b.ps[0];
      return !x ? 1 : !y ? -1 : zoneOrder[x.z] - zoneOrder[y.z] || x.s - y.s;
    })
    .filter(
      ({ r, ps }) => !q || (r.c + " " + r.d + " " + ps.map((p) => addr(p.z, p.s)).join(" ")).toLowerCase().includes(q),
    );
  $("planBody").innerHTML =
    rows
      .map(({ r, ps }) => {
        const sel = selected === r.c ? ' class="sel"' : "",
          zone = [...new Set(ps.map((p) => ZLAB[p.z]))].join(", "),
          ch = Math.round(r.w / Math.max(1, ps.length));
        if (editing === r.c)
          return `<tr${sel} data-c="${esc(r.c)}"><td><b>${esc(r.c)}</b></td><td><input data-f="d" value="${esc(r.d)}"></td>
      <td><select data-f="l">${[6, 12, 14, 15].map((v) => `<option value="${v}"${v === r.l ? " selected" : ""}>${v} m</option>`).join("")}</select></td>
      <td><select data-f="k">${Object.keys(KLAB)
        .map((k) => `<option${k === r.k ? " selected" : ""}>${k}</option>`)
        .join("")}</select></td><td>${zone}</td>
      <td>${ps.map((p) => `<span class="addr">${addr(p.z, p.s)}</span>`).join("")}</td><td class="num"><input data-f="b" type="number" min="0" value="${r.b}"></td>
      <td class="num"><input data-f="w" type="number" min="0" value="${r.w}"></td><td class="num">${fr(ch)}</td>
      <td class="act"><button type="button" class="ok" data-a="save">Enregistrer</button><button type="button" data-a="cancel">Annuler</button></td></tr>`;
        return `<tr${sel} data-c="${esc(r.c)}"><td><b>${esc(r.c)}</b></td><td>${esc(r.d)}</td><td>${r.l} m</td><td><span class="sw" style="background:${KCOL[r.k]}"></span>${KLAB[r.k]}</td><td>${zone}</td>
      <td>${ps.map((p) => (canEditPlan() ? `<button type="button" class="addr" data-p="${esc(p.id)}" title="Déplacer cet emplacement">${addr(p.z, p.s)} ▾</button>` : `<span class="addr">${addr(p.z, p.s)}</span>`)).join("")}</td>
      <td class="num">${fr(r.b)}</td><td class="num">${fr(r.w)}</td><td class="num">${fr(ch)}</td>
      <td class="act"><button type="button" data-a="edit">Modifier</button><button type="button" class="danger" data-a="del">${delAsk === r.c ? "Confirmer la suppression" : "Supprimer"}</button></td></tr>`;
      })
      .join("") || `<tr><td colspan="10" class="msg">Aucune référence ne correspond au filtre.</td></tr>`;
}
function afterChange(msg, err) {
  rebuildFree();
  save();
  refreshCodes();
  apply();
  renderTable();
  if (msg) planMsg(msg, err);
}
$("planSearch").addEventListener("input", renderTable);
$("planBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-c]");
  if (!tr) return;
  const c = tr.dataset.c,
    r = REFS.find((x) => x.c === c);
  const btn = canEditPlan() ? e.target.closest("button") : null;
  if (btn && btn.dataset.p) {
    const p = PIECES.find((x) => x.id === btn.dataset.p),
      opts = freeSlots(r.l);
    const sel = document.createElement("select");
    sel.className = "mv";
    sel.innerHTML =
      `<option value="">${addr(p.z, p.s)} (actuelle)</option>` +
      opts.map((o) => `<option value="${o.z}|${o.s}">${addr(o.z, o.s)}, ${ZLAB[o.z].toLowerCase()}</option>`).join("");
    btn.replaceWith(sel);
    sel.focus();
    sel.addEventListener("change", async () => {
      if (!sel.value) return renderTable();
      const [z, s2] = sel.value.split("|"),
        from = addr(p.z, p.s);
      if (
        !(await ask(
          "Confirmer le déplacement",
          `Déplacer <b>${r.c}</b> (${esc(r.d)})<br>de <b>${from}</b> vers <b>${addr(z, +s2)}</b> ?`,
        ))
      ) {
        renderTable();
        planMsg("Déplacement annulé.");
        return;
      }
      p.z = z;
      p.s = +s2;
      placeMesh(bundles.find((b) => b.userData.p === p));
      afterChange(`${r.c} déplacée de ${from} vers ${addr(p.z, p.s)}.`);
      select(r.c, p);
    });
    sel.addEventListener("blur", () =>
      setTimeout(() => {
        if ($("confirm").hidden) renderTable();
      }, 150),
    );
    return;
  }
  if (btn && btn.dataset.a === "edit") {
    editing = c;
    delAsk = null;
    return renderTable();
  }
  if (btn && btn.dataset.a === "cancel") {
    editing = null;
    return renderTable();
  }
  if (btn && btn.dataset.a === "save") {
    const v = (f) => tr.querySelector(`[data-f="${f}"]`).value,
      nl = +v("l");
    if (nl > 6 && piecesOf(c).some((p) => p.z !== "P"))
      return planMsg(
        `Impossible : ${c} est dans un cantilever, prévu pour des barres de 6 m. Déplacez-la d’abord sous le portique.`,
        true,
      );
    r.d = v("d").trim() || r.d;
    r.l = nl;
    r.k = v("k");
    r.b = Math.max(0, Math.round(+v("b") || 0));
    r.w = Math.max(0, Math.round(+v("w") || 0));
    syncN(r);
    piecesOf(c).forEach((p) => {
      const o = bundles.find((b) => b.userData.p === p);
      if (o) placeMesh(o);
    });
    editing = null;
    afterChange(`${c} modifiée.`);
    if (selected === c) select(c);
    return;
  }
  if (btn && btn.dataset.a === "del") {
    if (delAsk !== c) {
      delAsk = c;
      return renderTable();
    }
    piecesOf(c).forEach((p) => {
      removeMesh(p);
      PIECES.splice(PIECES.indexOf(p), 1);
    });
    REFS.splice(REFS.indexOf(r), 1);
    delAsk = null;
    if (selected === c) select(null);
    return afterChange(`${c} supprimée : ses emplacements sont libres.`);
  }
  if (!btn && !e.target.closest("input,select")) {
    const p = piecesOf(c)[0];
    if (p) select(c, p, true);
  }
});
// ajout d’une référence
function fillAddSlots() {
  const len = +$("aLen").value;
  $("aSlot").innerHTML =
    `<option value="">Automatique (premier emplacement libre adapté)</option>` +
    freeSlots(len)
      .map((o) => `<option value="${o.z}|${o.s}">${addr(o.z, o.s)}, ${ZLAB[o.z].toLowerCase()}</option>`)
      .join("");
}
$("addOpen").addEventListener("click", () => {
  $("addForm").classList.toggle("open");
  fillAddSlots();
  $("aCode").focus();
});
$("addCancel").addEventListener("click", () => $("addForm").classList.remove("open"));
$("aLen").addEventListener("change", fillAddSlots);
$("addSave").addEventListener("click", () => {
  if (!canEditPlan()) return;
  const c = $("aCode").value.trim(),
    d = $("aDes").value.trim(),
    l = +$("aLen").value,
    n = +$("aN").value;
  if (!c || !d) return planMsg("Indiquez au moins le code et la désignation.", true);
  if (REFS.find((r) => r.c === c)) return planMsg(`Le code ${c} existe déjà dans le plan de rangement.`, true);
  let slots;
  if ($("aSlot").value) {
    const [z, s0] = $("aSlot").value.split("|");
    slots = [{ z, s: +s0 }];
    if (n > 1) {
      const more = freeSlots(l)
        .filter((o) => o.z === z && o.s !== +s0)
        .slice(0, n - 1);
      if (more.length < n - 1) return planMsg("Pas assez d’emplacements libres dans cette zone.", true);
      slots = slots.concat(more);
    }
  } else slots = autoSlots(l, n);
  if (!slots) return planMsg(`Pas assez d’emplacements libres pour une barre de ${l} m.`, true);
  const r = {
    c,
    d,
    l,
    k: $("aK").value,
    b: Math.max(0, Math.round(+$("aBars").value || 0)),
    w: Math.max(0, Math.round(+$("aW").value || 0)),
    n,
    q: 0,
  };
  REFS.push(r);
  slots.forEach((o, i) => {
    const p = { id: c + "#" + i, r, z: o.z, s: o.s };
    PIECES.push(p);
    addMesh(p);
  });
  syncN(r);
  $("addForm").classList.remove("open");
  ["aCode", "aDes"].forEach((id) => ($(id).value = ""));
  afterChange(`${c} ajoutée en ${slots.map((o) => addr(o.z, o.s)).join(", ")}.`);
  select(
    c,
    PIECES.find((p) => p.r === r),
    true,
  );
});
$("copyTable").addEventListener("click", () => {
  const head = "Code\tDésignation\tLongueur\tClasse\tZone\tAdresse\tBarres\tPoids (kg)\tCharge par emplacement (kg)";
  const body = REFS.map((r) => {
    const ps = piecesOf(r.c);
    return [
      r.c,
      r.d,
      r.l + " m",
      r.k,
      [...new Set(ps.map((p) => ZLAB[p.z]))].join(", "),
      ps.map((p) => addr(p.z, p.s)).join(", "),
      r.b,
      r.w,
      Math.round(r.w / Math.max(1, ps.length)),
    ].join("\t");
  }).join("\n");
  (navigator.clipboard ? navigator.clipboard.writeText(head + "\n" + body) : Promise.reject())
    .then(() => {})
    .catch(() => planMsg("Copie impossible sur cet appareil.", true));
});

/* ---------- Export PDF ---------- */
function exportMsg(t, err) {
  const m = $("exportMsg");
  m.textContent = t;
  m.style.color = err ? "#ff8a80" : "";
  clearTimeout(exportMsg.t);
  if (t) exportMsg.t = setTimeout(() => (m.textContent = ""), 6000);
}
async function saveFile(filename, blob) {
  let dl = null;
  try {
    dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
  } catch (e) {
    dl = null;
  }
  if (dl) {
    await dl.save({ filename, data: blob });
    return;
  }
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function captureAt(aspect) {
  const sv = {
    p: pcam.position.clone(),
    t: controls.target.clone(),
    pa: pcam.aspect,
    ol: ocam.left,
    or: ocam.right,
    ot: ocam.top,
    ob: ocam.bottom,
    oz: ocam.zoom,
    op: ocam.position.clone(),
    ct: ocontrols.target.clone(),
  };
  renderer.setSize(2400, Math.round(2400 / aspect), false);
  pcam.aspect = aspect;
  pcam.updateProjectionMatrix();
  if (mode === "plan") {
    const hh = ocam.top;
    ocam.left = -hh * aspect;
    ocam.right = hh * aspect;
    ocam.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  const data = renderer.domElement.toDataURL("image/jpeg", 0.92);
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  pcam.aspect = sv.pa;
  pcam.updateProjectionMatrix();
  ocam.left = sv.ol;
  ocam.right = sv.or;
  ocam.top = sv.ot;
  ocam.bottom = sv.ob;
  ocam.zoom = sv.oz;
  ocam.position.copy(sv.op);
  ocam.updateProjectionMatrix();
  ocontrols.target.copy(sv.ct);
  pcam.position.copy(sv.p);
  controls.target.copy(sv.t);
  pcam.updateProjectionMatrix();
  return data;
}
async function exportReport() {
  if (!window.jspdf) {
    exportMsg("Le module PDF n’est pas chargé : vérifiez la connexion Internet.", true);
    return;
  }
  const btn = $("exportBtn");
  btn.disabled = true;
  exportMsg("Préparation du rapport…");
  try {
    const { jsPDF } = window.jspdf,
      doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }),
      W = 297,
      H = 210,
      now = new Date();
    doc.addFileToVFS("Carlito-Regular.ttf", FONT_R);
    doc.addFont("Carlito-Regular.ttf", "Calibri", "normal");
    doc.addFileToVFS("Carlito-Bold.ttf", FONT_B);
    doc.addFont("Carlito-Bold.ttf", "Calibri", "bold");
    doc.setFont("Calibri", "normal");
    const clean = (t) => String(t).replace(/[\u202f\u00a0]/g, " "),
      _text = doc.text.bind(doc);
    doc.text = (t, ...a) => _text(Array.isArray(t) ? t.map(clean) : clean(t), ...a);
    const dstr = now.toLocaleDateString("fr-FR"),
      tstr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    // bandeau
    doc.setFillColor(40, 46, 52);
    doc.rect(0, 0, W, 30, "F");
    doc.setFillColor(242, 194, 48);
    doc.rect(0, 30, W / 3, 1.4, "F");
    doc.setFillColor(238, 138, 44);
    doc.rect(W / 3, 30, W / 3, 1.4, "F");
    doc.setFillColor(53, 87, 201);
    doc.rect((2 * W) / 3, 30, W / 3, 1.4, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(7, 3, 37, 24, 2.5, 2.5, "F");
    try {
      doc.addImage(LOGO_SRC, "JPEG", 8.5, 3.9, 34, 22.2);
    } catch (e) {}
    doc.setTextColor(255, 255, 255);
    doc.setFont("Calibri", "bold");
    doc.setFontSize(20);
    doc.text("Stockage ferrailles, zone AT1 – flux amont", 48, 14);
    doc.setFont("Calibri", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(200, 208, 215);
    doc.text(`Exporté le ${dstr} à ${tstr}`, 48, 22);
    // indicateurs
    const occ = (z) => [slotsUsed(z), capZone(z)],
      tot = ["P", "M", "E"].reduce((a, z) => [a[0] + slotsUsed(z), a[1] + capZone(z)], [0, 0]);
    const kp = [
      ["Références", String(REFS.length), `${fr(REFS.reduce((a, r) => a + r.w, 0) / 1000)} t stockées`, [242, 194, 48]],
      ["Sous le portique", `${occ("P")[0]} / ${occ("P")[1]}`, `${pct(...occ("P"))} % des emplacements`, [238, 138, 44]],
      [
        "Cantilevers milieu",
        `${pct(...occ("M"))} %`,
        `${occ("M")[0]} / ${occ("M")[1]} emplacements, ${4 - hiddenOf("M")} racks`,
        [53, 87, 201],
      ],
      [
        "Cantilevers Est",
        `${pct(...occ("E"))} %`,
        `${occ("E")[0]} / ${occ("E")[1]} emplacements, ${4 - hiddenOf("E")} racks`,
        [28, 124, 156],
      ],
      ["Occupation globale", `${pct(...tot)} %`, `${tot[0]} occupés, ${tot[1] - tot[0]} libres`, [47, 158, 68]],
    ];
    const kw = (W - 20 - 4 * 4) / 5;
    kp.forEach((k, i) => {
      const x = 10 + i * (kw + 4),
        y = 37;
      doc.setDrawColor(217, 223, 229);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, kw, 24, 2, 2, "FD");
      doc.setTextColor(91, 104, 116);
      doc.setFontSize(9);
      doc.text(k[0], x + 5, y + 6);
      doc.setTextColor(24, 35, 45);
      doc.setFont("Calibri", "bold");
      doc.setFontSize(17);
      doc.text(k[1], x + 5, y + 15);
      doc.setFont("Calibri", "normal");
      doc.setFontSize(8.2);
      doc.setTextColor(91, 104, 116);
    });
    // une seule page : indicateurs en haut, graphiques à gauche, maquette à droite
    const occRGB = (p) => (p <= 85 ? [47, 158, 68] : p <= 92 ? [245, 159, 0] : [224, 49, 49]);
    const annulus = (cx, cy, ro, ri, p, col) => {
      const f = Math.min(1, Math.max(0, p));
      if (f <= 0) return;
      const N = Math.max(3, Math.round(f * 90)),
        pts = [];
      for (let i = 0; i <= N; i++) {
        const an = -Math.PI / 2 + (2 * Math.PI * f * i) / N;
        pts.push([cx + ro * Math.cos(an), cy + ro * Math.sin(an)]);
      }
      for (let i = N; i >= 0; i--) {
        const an = -Math.PI / 2 + (2 * Math.PI * f * i) / N;
        pts.push([cx + ri * Math.cos(an), cy + ri * Math.sin(an)]);
      }
      const rel = [];
      for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
      doc.setFillColor(...col);
      doc.lines(rel, pts[0][0], pts[0][1], [1, 1], "F", true);
    };
    const ks = ["A", "B", "C", "Sans historique"],
      kc = { A: [47, 158, 68], B: [245, 159, 0], C: [224, 49, 49], "Sans historique": [112, 72, 232] };
    const LX = 10,
      LW = 78,
      MX = 92,
      MW = W - 10 - MX,
      TOP = 66,
      BOT = 196;
    const card = (x, y, w, h, title) => {
      doc.setLineWidth(0.2);
      doc.setDrawColor(217, 223, 229);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, w, h, 2, 2, "FD");
      doc.setTextColor(24, 35, 45);
      doc.setFont("Calibri", "bold");
      doc.setFontSize(9);
      doc.text(title, x + 4, y + 6.5);
      doc.setFont("Calibri", "normal");
    };
    const ring = (cx, cy, r, w, p, col) => {
      doc.setLineWidth(w);
      doc.setDrawColor(...col);
      const f = Math.min(1, Math.max(0, p)),
        N = Math.max(2, Math.round(f * 72));
      let px = cx,
        py = cy - r;
      for (let i = 1; i <= N; i++) {
        const an = -Math.PI / 2 + (2 * Math.PI * f * i) / N,
          x = cx + r * Math.cos(an),
          y = cy + r * Math.sin(an);
        doc.line(px, py, x, y);
        px = x;
        py = y;
      }
    };
    const hbar = (x, y, w, label, val, frac, col) => {
      doc.setFontSize(9);
      doc.setTextColor(24, 35, 45);
      doc.text(label, x, y + 3.3);
      const bx = x + 26,
        bwid = w - 26 - 14;
      doc.setFillColor(230, 234, 238);
      doc.rect(bx, y, bwid, 4, "F");
      doc.setFillColor(...col);
      doc.rect(bx, y, Math.max(0.5, bwid * Math.min(1, Math.max(0, frac))), 4, "F");
      doc.setFont("Calibri", "bold");
      doc.text(val, x + w, y + 3.3, { align: "right" });
      doc.setFont("Calibri", "normal");
    };
    // 1. occupation globale
    const h1 = 44,
      y1 = TOP;
    card(LX, y1, LW, h1, "Occupation globale");
    const pG = pct(tot[0], tot[1]),
      cxD = LX + 17,
      cyD = y1 + 25;
    annulus(cxD, cyD, 12, 8, 1, [226, 230, 234]);
    annulus(cxD, cyD, 12, 8, tot[1] ? tot[0] / tot[1] : 0, occRGB(pG));
    doc.setFont("Calibri", "bold");
    doc.setFontSize(11);
    doc.setTextColor(24, 35, 45);
    doc.text(`${pG} %`, cxD, cyD + 1.6, { align: "center" });
    doc.setFont("Calibri", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(91, 104, 116);
    doc.text(`${tot[0]} occupés`, LX + 34, y1 + 20);
    doc.text(`${tot[1] - tot[0]} libres`, LX + 34, y1 + 26);
    doc.text(`sur ${tot[1]} au total`, LX + 34, y1 + 32);
    // 2. références par classe
    const y2 = y1 + h1 + 3,
      h2 = 40,
      nmax = Math.max(1, ...ks.map((k) => REFS.filter((r) => r.k === k).length));
    card(LX, y2, LW, h2, "Références par classe");
    ks.forEach((k, i) => {
      const n = REFS.filter((r) => r.k === k).length;
      hbar(LX + 4, y2 + 12 + i * 6.5, LW - 8, KLAB[k], String(n), n / nmax, kc[k]);
    });
    // 3. occupation par zone
    const y3 = y2 + h2 + 3,
      h3 = 40;
    card(LX, y3, LW, h3, "Occupation par zone");
    [
      ["P", "Portique"],
      ["M", "Milieu"],
      ["E", "Est"],
    ].forEach(([z, l], i) => {
      const p = pct(slotsUsed(z), capZone(z));
      hbar(LX + 4, y3 + 12 + i * 7, LW - 8, l, `${p} %`, p / 100, occRGB(p));
    });
    doc.setFontSize(7);
    doc.setTextColor(91, 104, 116);
    // maquette, à droite, dans le cadre disponible (le site occupe toute la largeur)
    const hid = [...hiddenRacks].map((k) => (k[0] === "M" ? "milieu" : "Est") + " T" + k[1]);
    const shot = captureAt(MW / (BOT - TOP));
    doc.setDrawColor(217, 223, 229);
    doc.rect(MX - 0.5, TOP - 0.5, MW + 1, BOT - TOP + 1);
    doc.addImage(shot, "JPEG", MX, TOP, MW, BOT - TOP);
    const modeName = { global: "3D vue globale", plan: "plan 2D", walk: "3D vue marchant" }[mode];
    doc.setFontSize(7.5);
    doc.setTextColor(91, 104, 116);
    // tableau des références
    doc.addPage();
    doc.setFont("Calibri", "bold");
    doc.setFontSize(15);
    doc.setTextColor(24, 35, 45);
    doc.text("Plan de rangement : adresse de chaque référence", 10, 14);
    const zo = { P: 0, M: 1, E: 2 },
      rows = REFS.map((r) => ({ r, ps: piecesOf(r.c).sort((a, b) => zo[a.z] - zo[b.z] || a.s - b.s) })).sort((a, b) => {
        const x = a.ps[0],
          y = b.ps[0];
        return !x ? 1 : !y ? -1 : zo[x.z] - zo[y.z] || x.s - y.s;
      });
    doc.autoTable({
      startY: 24,
      margin: { left: 10, right: 10 },
      theme: "grid",
      styles: {
        font: "Calibri",
        fontSize: 8,
        cellPadding: 1.6,
        lineColor: [217, 223, 229],
        lineWidth: 0.15,
        textColor: [24, 35, 45],
      },
      headStyles: { fillColor: [40, 46, 52], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 248, 250] },
      head: [
        [
          "Code",
          "Désignation",
          "Longueur",
          "Classe",
          "Zone",
          "Adresse(s)",
          "Barres",
          "Poids (kg)",
          "Charge / empl. (kg)",
        ],
      ],
      body: rows.map(({ r, ps }) => [
        r.c,
        r.d,
        r.l + " m",
        KLAB[r.k],
        [...new Set(ps.map((p) => ZLAB[p.z]))].join(", "),
        ps.map((p) => addr(p.z, p.s)).join(", "),
        fr(r.b),
        fr(r.w),
        fr(r.w / Math.max(1, ps.length)),
      ]),
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 62 },
        2: { cellWidth: 16 },
        3: { cellWidth: 25 },
        4: { cellWidth: 32 },
        6: { halign: "right", cellWidth: 16 },
        7: { halign: "right", cellWidth: 20 },
        8: { halign: "right", cellWidth: 26 },
      },
      didParseCell: (d) => {
        d.cell.text = d.cell.text.map(clean);
        if (d.section === "body" && d.column.index === 3) {
          const k = rows[d.row.index].r.k;
          d.cell.styles.textColor = kc[k];
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    const ch = changes();
    if (ch.length) {
      doc.addPage();
      doc.setFont("Calibri", "bold");
      doc.setFontSize(15);
      doc.setTextColor(24, 35, 45);
      doc.text("Modifications par rapport au plan du classeur", 10, 14);
      doc.autoTable({
        startY: 20,
        margin: { left: 10, right: 10 },
        theme: "grid",
        styles: { font: "Calibri", fontSize: 8.5, cellPadding: 1.8 },
        headStyles: { fillColor: [40, 46, 52], textColor: 255 },
        head: [["Type", "Code", "Désignation", "Détail"]],
        body: ch.map((x) => [x.t, x.c, x.d, x.txt]),
      });
    }
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      try {
        doc.addImage(LOGO_SRC, "JPEG", 10, H - 12, 11.3, 8);
      } catch (e) {}
      doc.setFontSize(8);
      doc.setTextColor(140, 150, 160);
      doc.text(`Stockage ferrailles, zone AT1 – flux amont. Page ${i} sur ${n}.`, W - 10, H - 6, { align: "right" });
    }
    const fn = `Rapport_stockage_ferrailles_AT1_${now.toISOString().slice(0, 10)}_${tstr.replace(":", "h")}.pdf`;
    await saveFile(fn, doc.output("blob"));
    exportMsg(`Rapport exporté : ${fn}`);
  } catch (e) {
    exportMsg(
      e && e.code === "declined" ? "Export annulé." : "L’export n’a pas pu se faire sur cet appareil.",
      e && e.code !== "declined",
    );
  } finally {
    btn.disabled = false;
  }
}
$("exportBtn").addEventListener("click", exportReport);

/* ---------- Modification en masse ---------- */
const HEAD = [
  "Action",
  "Code",
  "Désignation",
  "Longueur (m)",
  "Classe",
  "Barres",
  "Poids (kg)",
  "Adresse actuelle",
  "Nouvelle adresse",
];
function parseAddr(t) {
  t = String(t || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  let m = t.match(/^POR-?0*(\d{1,3})$/);
  if (m) {
    const s = +m[1];
    return s >= 1 && s <= CAP.P ? { z: "P", s } : null;
  }
  m = t.match(/^(MIL|EST)-?T([1-4])-?0*(\d{1,2})$/);
  if (!m) return null;
  const e = +m[3];
  if (e < 1 || e > 16) return null;
  const face = e > 8 ? 1 : 0,
    lv = e > 8 ? e - 8 : e,
    c = (+m[2] - 1) * 2 + face;
  return { z: m[1] === "MIL" ? "M" : "E", s: c * 8 + lv };
}
const normK = (v) => {
  const t = String(v || "")
    .trim()
    .toLowerCase();
  return t === "a" ? "A" : t === "b" ? "B" : t === "c" ? "C" : /^(sh|sans)/.test(t) ? "Sans historique" : null;
};
async function bulkModel() {
  if (!window.XLSX) {
    planMsg("Le module Excel n’est pas chargé : vérifiez la connexion Internet.", true);
    return;
  }
  const zo = { P: 0, M: 1, E: 2 },
    rows = REFS.map((r) => ({ r, ps: piecesOf(r.c).sort((a, b) => zo[a.z] - zo[b.z] || a.s - b.s) })).sort((a, b) => {
      const x = a.ps[0],
        y = b.ps[0];
      return !x ? 1 : !y ? -1 : zo[x.z] - zo[y.z] || x.s - y.s;
    });
  const wb = XLSX.utils.book_new(),
    plan = [HEAD].concat(
      rows.map(({ r, ps }) => ["", r.c, r.d, r.l, r.k, r.b, r.w, ps.map((p) => addr(p.z, p.s)).join(", "), ""]),
    );
  const ws = XLSX.utils.aoa_to_sheet(plan);
  ws["!cols"] = [10, 12, 34, 12, 15, 9, 11, 22, 22].map((w) => ({ wch: w }));
  ws["!autofilter"] = { ref: "A1:I" + plan.length };
  XLSX.utils.book_append_sheet(wb, ws, "Plan de rangement");
  const occ = occupied(),
    libres = [["Emplacement libre", "Zone", "Accepte"]];
  ["P", "M", "E"].forEach((z) => {
    for (let s2 = 1; s2 <= CAP[z]; s2++)
      if (!occ[z].has(s2)) libres.push([addr(z, s2), ZLAB[z], z === "P" ? "toutes longueurs" : "barres de 6 m"]);
  });
  const wl = XLSX.utils.aoa_to_sheet(libres);
  wl["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wl, "Emplacements libres");
  const help = [
    ["Mode d’emploi"],
    [""],
    [
      "Nouvelle adresse : POR-001 à POR-031 (portique), MIL-T1-001 à MIL-T4-016 et EST-T1-001 à EST-T4-016 (cantilevers).",
    ],
    [
      "Dans chaque travée, 001 à 008 = face A du bas vers le haut, 009 à 016 = face B. Plusieurs adresses : séparez-les par des virgules.",
    ],
    [
      "Modifier : changez la désignation, la longueur, la classe (A, B, C ou Sans historique), les barres ou le poids. Une cellule vide = pas de changement.",
    ],
    ["Supprimer : écrivez SUPPRIMER dans la colonne Action."],
    ["Ajouter : nouvelle ligne avec un nouveau code, la désignation, la longueur, la classe et la nouvelle adresse."],
    [
      "Règle : les cantilevers n’acceptent que des barres de 6 m. Chargez ensuite le fichier dans la maquette : un aperçu s’affiche avant d’appliquer.",
    ],
  ];
  const wh = XLSX.utils.aoa_to_sheet(help);
  wh["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wh, "Mode d’emploi");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }),
    fn = "Modele_modification_masse_AT1.xlsx";
  try {
    await saveFile(fn, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    planMsg(`Modèle téléchargé : ${fn}`);
  } catch (e) {
    try {
      await saveFile(
        "Modele_modification_masse_AT1.csv",
        new Blob(
          ["\ufeff" + plan.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n")],
          { type: "text/csv" },
        ),
      );
      planMsg("Modèle téléchargé au format CSV.");
    } catch (e2) {
      planMsg("Téléchargement impossible sur cet appareil.", true);
    }
  }
}
let BULK = null;
function rowsFromText(t) {
  const lines = t
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : ";";
  return lines.map((l) => l.split(sep).map((v) => v.replace(/^"|"$/g, "").replace(/""/g, '"').trim()));
}
function analyseBulk(rows) {
  if (!rows.length) return { ops: [], rep: [] };
  const H = rows[0].map((h) => String(h).trim().toLowerCase()),
    col = (k) => H.findIndex((h) => h.startsWith(k));
  const ix = {
    a: col("action"),
    c: col("code"),
    d: col("désignation") >= 0 ? col("désignation") : col("designation"),
    l: col("longueur"),
    k: col("classe"),
    b: col("barres"),
    w: col("poids"),
    cur: col("adresse actuelle"),
    nw: col("nouvelle adresse"),
  };
  if (ix.c < 0)
    return {
      ops: [],
      rep: [{ ln: 1, c: "", act: "", det: "Colonne Code introuvable : utilisez le modèle téléchargé.", ok: false }],
    };
  const occ = occupied(),
    taken = { P: new Map(), M: new Map(), E: new Map() };
  ["P", "M", "E"].forEach((z) => occ[z].forEach((p, s2) => taken[z].set(s2, p.r.c)));
  const ops = [],
    rep = [],
    seen = new Set();
  rows.slice(1).forEach((row, i) => {
    const ln = i + 2,
      g = (k) => (ix[k] >= 0 ? String(row[ix[k]] ?? "").trim() : "");
    const c = g("c");
    if (!c) return;
    if (seen.has(c)) {
      rep.push({ ln, c, act: "", det: "Code présent plusieurs fois dans le fichier.", ok: false });
      return;
    }
    seen.add(c);
    const r = REFS.find((x) => x.c === c),
      action = g("a").toUpperCase();
    if (action.startsWith("SUPP")) {
      if (!r) {
        rep.push({ ln, c, act: "Suppression", det: "Code inconnu.", ok: false });
        return;
      }
      piecesOf(c).forEach((p) => taken[p.z].delete(p.s));
      ops.push({ t: "del", c });
      rep.push({
        ln,
        c,
        act: "Suppression",
        det: `${piecesOf(c)
          .map((p) => addr(p.z, p.s))
          .join(", ")} libéré(s)`,
        ok: true,
      });
      return;
    }
    const errs = [],
      ch = {};
    const d = g("d"),
      l = g("l"),
      k = g("k"),
      b = g("b"),
      w = g("w"),
      nw = g("nw");
    if (l) {
      const v = parseInt(l, 10);
      if ([6, 12, 14, 15].includes(v)) ch.l = v;
      else errs.push(`longueur « ${l} » non reconnue (6, 12, 14 ou 15)`);
    }
    if (k) {
      const v = normK(k);
      if (v) ch.k = v;
      else errs.push(`classe « ${k} » non reconnue`);
    }
    if (b) {
      const v = parseInt(String(b).replace(/\s/g, ""), 10);
      if (v >= 0) ch.b = v;
      else errs.push("barres invalides");
    }
    if (w) {
      const v = parseFloat(String(w).replace(/\s/g, "").replace(",", "."));
      if (v >= 0) ch.w = Math.round(v);
      else errs.push("poids invalide");
    }
    if (d) ch.d = d;
    let slots = null;
    const addrTxt = nw || (!r ? g("cur") : "");
    if (addrTxt) {
      const parts = addrTxt
        .split(/[,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      slots = parts.map(parseAddr);
      if (slots.some((x) => !x)) {
        errs.push(`adresse non reconnue : ${parts.filter((x, j) => !slots[j]).join(", ")}`);
        slots = null;
      }
    }
    const len = ch.l || (r && r.l);
    if (!r && (!d || !len || !slots))
      errs.push("nouvelle référence : il faut au moins la désignation, la longueur et l’adresse");
    if (slots && len > 6 && slots.some((x) => x.z !== "P"))
      errs.push(`une barre de ${len} m ne peut pas aller dans un cantilever`);
    if (r && !slots && len > 6 && ch.l && piecesOf(c).some((p) => p.z !== "P"))
      errs.push(`longueur ${len} m impossible : la référence est dans un cantilever`);
    if (slots && !errs.length) {
      const clash = slots
        .filter((x) => taken[x.z].has(x.s) && taken[x.z].get(x.s) !== c)
        .map((x) => `${addr(x.z, x.s)} (occupé par ${taken[x.z].get(x.s)})`);
      if (clash.length) errs.push("emplacement déjà pris : " + clash.join(", "));
      else {
        if (r) piecesOf(c).forEach((p) => taken[p.z].delete(p.s));
        slots.forEach((x) => taken[x.z].set(x.s, c));
      }
    }
    if (errs.length) {
      rep.push({ ln, c, act: r ? "Modification" : "Ajout", det: errs.join(" ; "), ok: false });
      return;
    }
    if (!r) {
      ops.push({ t: "add", c, ch, slots });
      rep.push({ ln, c, act: "Ajout", det: `${d} en ${slots.map((x) => addr(x.z, x.s)).join(", ")}`, ok: true });
      return;
    }
    const diff = Object.keys(ch).filter((f) => String(ch[f]) !== String(r[f])),
      moved =
        slots &&
        slots.map((x) => addr(x.z, x.s)).join(", ") !==
          piecesOf(c)
            .map((p) => addr(p.z, p.s))
            .join(", ");
    if (!diff.length && !moved) return;
    ops.push({ t: "mod", c, ch: Object.fromEntries(diff.map((f) => [f, ch[f]])), slots: moved ? slots : null });
    rep.push({
      ln,
      c,
      act: moved && diff.length ? "Déplacement et modification" : moved ? "Déplacement" : "Modification",
      det: [
        moved
          ? `${piecesOf(c)
              .map((p) => addr(p.z, p.s))
              .join(", ")} → ${slots.map((x) => addr(x.z, x.s)).join(", ")}`
          : "",
        diff
          .map((f) => ({ d: "désignation", l: "longueur", k: "classe", b: "barres", w: "poids" })[f] + " : " + ch[f])
          .join(", "),
      ]
        .filter(Boolean)
        .join(" ; "),
      ok: true,
    });
  });
  return { ops, rep };
}
function showBulk(res) {
  BULK = res;
  const okN = res.rep.filter((x) => x.ok).length,
    koN = res.rep.length - okN;
  $("bReport").innerHTML = res.rep.length
    ? `<b>${okN}</b> modification${okN > 1 ? "s" : ""} prête${okN > 1 ? "s" : ""}${koN ? `, <span class="ko">${koN} ligne${koN > 1 ? "s" : ""} en erreur (ignorée${koN > 1 ? "s" : ""})</span>` : ""}.
    <table><thead><tr><th>Ligne</th><th>Code</th><th>Action</th><th>Détail</th><th>Statut</th></tr></thead><tbody>${res.rep.map((x) => `<tr><td>${x.ln}</td><td>${esc(x.c)}</td><td>${x.act}</td><td>${esc(x.det)}</td><td class="${x.ok ? "ok" : "ko"}">${x.ok ? "OK" : "Erreur"}</td></tr>`).join("")}</tbody></table>`
    : "Aucun changement détecté par rapport au plan actuel.";
  $("bApply").disabled = !okN;
  $("bApply").textContent = okN
    ? `Appliquer les ${okN} modification${okN > 1 ? "s" : ""}`
    : "Appliquer les modifications";
}
async function readBulk() {
  const f = $("bFile").files[0],
    t = $("bPaste").value.trim();
  try {
    if (f) {
      if (/\.csv$/i.test(f.name)) showBulk(analyseBulk(rowsFromText(await f.text())));
      else {
        if (!window.XLSX) throw new Error("module Excel absent");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        showBulk(
          analyseBulk(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" })),
        );
      }
    } else if (t) showBulk(analyseBulk(rowsFromText(t)));
    else $("bReport").innerHTML = '<span class="ko">Choisissez un fichier ou collez des lignes.</span>';
  } catch (e) {
    $("bReport").innerHTML =
      '<span class="ko">Fichier illisible : utilisez le modèle téléchargé (.xlsx ou .csv).</span>';
  }
}
async function applyBulk() {
  if (!BULK || !BULK.ops.length || !canEditPlan()) return;
  const n = BULK.ops.length;
  if (
    !(await ask(
      "Confirmer la modification en masse",
      `Appliquer <b>${n}</b> modification${n > 1 ? "s" : ""} au plan de rangement ?`,
    ))
  )
    return;
  const st = stateNow();
  BULK.ops.forEach((op) => {
    if (op.t === "del") {
      st.refs = st.refs.filter((r) => r.c !== op.c);
      st.pieces = st.pieces.filter((p) => p.c !== op.c);
      return;
    }
    if (op.t === "add") {
      st.refs.push({ c: op.c, d: op.ch.d, l: op.ch.l, k: op.ch.k || "C", b: op.ch.b || 0, w: op.ch.w || 0 });
      op.slots.forEach((x, i) => st.pieces.push({ id: op.c + "#" + i, c: op.c, z: x.z, s: x.s }));
      return;
    }
    const r = st.refs.find((x) => x.c === op.c);
    Object.assign(r, op.ch);
    if (op.slots) {
      st.pieces = st.pieces.filter((p) => p.c !== op.c);
      op.slots.forEach((x, i) => st.pieces.push({ id: op.c + "#" + i, c: op.c, z: x.z, s: x.s }));
    }
  });
  applyState(st);
  save();
  renderMoves();
  $("bulk").hidden = true;
  BULK = null;
  planMsg(`${n} modification${n > 1 ? "s" : ""} appliquée${n > 1 ? "s" : ""}.`);
}
$("bulkOpen").addEventListener("click", () => {
  if (!canEditPlan()) return;
  $("bReport").innerHTML = "";
  $("bApply").disabled = true;
  $("bFile").value = "";
  $("bPaste").value = "";
  $("bulk").hidden = false;
});
$("bClose").addEventListener("click", () => ($("bulk").hidden = true));
$("bModel").addEventListener("click", bulkModel);
$("bRead").addEventListener("click", readBulk);
$("bApply").addEventListener("click", applyBulk);

/* ---------- Publication GitHub ---------- */
if ($("exportPlan"))
  $("exportPlan").addEventListener("click", async () => {
    const at = Date.now(),
      d = new Date(at),
      txt = `// Plan publié depuis la page d’édition le ${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.\n// Déposez ce fichier à la racine du dépôt GitHub (il remplace l’ancien plan.js).\nwindow.PLAN = ${JSON.stringify({ ...stateNow(), at })};\n`;
    try {
      await saveFile("plan.js", new Blob([txt], { type: "text/javascript" }));
      planMsg("plan.js exporté : déposez-le sur GitHub pour publier le plan.");
    } catch (e) {
      planMsg("Export impossible sur cet appareil.", true);
    }
  });
if ($("resetDraft"))
  $("resetDraft").addEventListener("click", () => {
    store.set(DRAFT_KEY, null);
    location.reload();
  });

/* ---------- Gestion du stock ---------- */
const STOCK_SRC_DATE = "01/11/2026";
const STAT = {
  R: { lab: "Rupture", col: "#8B1A1A" },
  C: { lab: "Critique", col: "#E03131" },
  O: { lab: "Sous le seuil", col: "#F08C00" },
  N: { lab: "Normal", col: "#2F9E44" },
  S: { lab: "Surstock", col: "#1C7ED6" },
};
const STOCKS = {
  db: null,
  user: null,
  uid: null,
  seuils: {},
  base: null,
  baseAt: 0,
  mvts: [],
  hist: [],
  names: {},
  ready: false,
  unsub: null,
  colorMode: "abc",
};
const fmt0 = (v) =>
  Math.round(v)
    .toLocaleString("fr-FR")
    .replace(/[\u202f\u00a0]/g, " ");
const fmtE = (v) => {
  const a = Math.abs(v),
    dec = (x, d) =>
      x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/[\u202f\u00a0]/g, " "); // montants abrégés : K€, M€
  return a >= 1e6
    ? dec(v / 1e6, 1) + " M€"
    : a >= 1e5
      ? dec(v / 1e3, 0) + " K€"
      : a >= 1e3
        ? dec(v / 1e3, 1) + " K€"
        : fmt0(v) + " €";
};
const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
function seuilsOf(c) {
  const b = STOCK0[c] || { mini: 0, secu: 0, seuil: 0, maxi: 0 },
    o = STOCKS.seuils[c] || {};
  return { mini: o.mini ?? b.mini, secu: o.secu ?? b.secu, seuil: o.seuil ?? b.seuil, maxi: o.maxi ?? b.maxi };
}
let ECARTS = {},
  LASTOUT = {};
function stockLevels() {
  const q = {};
  ECARTS = {};
  LASTOUT = {};
  Object.keys(STOCK0).forEach(
    (c) => (q[c] = STOCKS.base && STOCKS.base[c] !== undefined ? STOCKS.base[c] : STOCK0[c].q),
  );
  STOCKS.mvts
    .slice()
    .sort((a, b) => a.at - b.at)
    .forEach((m) => {
      if (q[m.c] === undefined) q[m.c] = 0;
      if (m.t === "E") q[m.c] += m.qty;
      else if (m.t === "S") {
        q[m.c] -= m.qty;
        LASTOUT[m.c] = Math.max(LASTOUT[m.c] || 0, m.at);
      } else if (m.t === "A") {
        ECARTS[m.c] = { diff: m.qty - q[m.c], before: q[m.c], d: m.d, at: m.at };
        q[m.c] = m.qty;
      }
    });
  return q;
}
function statusOf(c, q) {
  const t = seuilsOf(c);
  if (t.maxi <= 0) return q > 0 ? "S" : "N";
  if (q <= 0) return "R";
  if (q < t.secu) return "C";
  if (q <= t.seuil) return "O";
  if (q > t.maxi) return "S";
  return "N";
}
let LEVELS = {};
function recompute() {
  LEVELS = stockLevels();
}
function stockLine(c) {
  if (!STOCK0[c]) return "";
  const q = LEVELS[c] ?? STOCK0[c].q,
    s = statusOf(c, q);
  return `${fmt0(q)} m · <span class="chip" style="background:${STAT[s].col}">${STAT[s].lab}</span>`;
}
function colorOf(r) {
  if (STOCKS.colorMode !== "stock" || !STOCK0[r.c]) return KCOL[r.k];
  return STAT[statusOf(r.c, LEVELS[r.c] ?? STOCK0[r.c].q)].col;
}
function renderLegend() {
  const items =
    STOCKS.colorMode === "stock"
      ? Object.values(STAT).map((s) => [s.col, s.lab])
      : Object.keys(KCOL).map((k) => [KCOL[k], KLAB[k]]);
  $("legend3d").innerHTML =
    items.map(([c, l]) => `<div><span class="sw" style="background:${c}"></span>${l}</div>`).join("") +
    `<div><span class="sw" style="background:rgba(140,152,163,.35)"></span>Emplacement libre</div>`;
}

// ----- rendu de la page -----
function renderStock() {
  if (!$("stockPage")) return;
  recompute();
  const rows = Object.keys(STOCK0).map((c) => {
    const r = REFS.find((x) => x.c === c),
      b = STOCK0[c],
      q = LEVELS[c],
      t = seuilsOf(c),
      s = statusOf(c, q);
    const ps = r ? piecesOf(c) : [],
      adr = ps.map((p) => addr(p.z, p.s)).join(", "),
      cov = b.conso > 0 ? q / (b.conso / 365) : null;
    return {
      c,
      d: r ? r.d : "",
      l: r ? r.l : 0,
      k: r ? r.k : "",
      z: ps[0] ? ps[0].z : "",
      adr,
      q,
      t,
      s,
      cov,
      val: q * b.cu,
      cu: b.cu,
      del: b.del,
      sug: ["R", "C", "O"].includes(s) ? Math.max(0, t.maxi - q) : 0,
    };
  });
  const cnt = (s) => rows.filter((x) => x.s === s).length,
    val = rows.reduce((a, x) => a + Math.max(0, x.val), 0),
    over = rows.reduce((a, x) => a + Math.max(0, x.q - x.t.maxi) * x.cu, 0);
  const since = Date.now() - 30 * 864e5,
    m30 = STOCKS.hist.filter((m) => m.at >= since).length;
  $("skpis").innerHTML = `<div class="kpi t"><div class="v">${fmtE(val)}</div><div class="l">valeur du stock</div></div>
    <div class="kpi"><div class="v" style="color:${STAT.O.col}">${cnt("C") + cnt("O")}</div><div class="l">sous le seuil de réappro</div></div>
    <div class="kpi"><div class="v" style="color:${STAT.R.col}">${cnt("R")}</div><div class="l">en rupture</div></div>
    <div class="kpi"><div class="v" style="color:${STAT.S.col}">${cnt("S")}</div><div class="l">en surstock, ${fmtE(over)} au-dessus du maxi</div></div>
    <div class="kpi m"><div class="v">${m30}</div><div class="l">mouvements sur 30 jours</div></div>`;
  // derniers mouvements
  const TL = { E: "Entrée", S: "Sortie", A: "Inventaire" };
  $("mvTbl").innerHTML =
    `<thead><tr><th>Date</th><th>Code</th><th>Type</th><th>Quantité (m)</th><th>Par</th></tr></thead><tbody>` +
    (STOCKS.hist.length
      ? STOCKS.hist
          .slice(0, 200)
          .map(
            (m) =>
              `<tr><td>${esc(m.d || "")}</td><td>${esc(m.c)}</td><td><span class="mvt ${m.t}">${TL[m.t]}</span></td><td class="n">${m.t === "S" ? "−" : m.t === "E" ? "+" : "= "}${fmt0(m.qty)}</td><td>${esc(STOCKS.names[m.by] || (m.by ? "Éditeur" : "Cet appareil"))}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5">Aucun mouvement enregistré pour l’instant.</td></tr>`) +
    "</tbody>";
  // stock par référence
  const qtxt = ($("stSearch").value || "").trim().toLowerCase(),
    fs = $("stStatus").value,
    fz = $("stZone").value;
  const list = rows
    .filter(
      (x) =>
        (!fs || x.s === fs) &&
        (!fz || x.z === fz) &&
        (!qtxt || (x.c + " " + x.d + " " + x.adr).toLowerCase().includes(qtxt)),
    )
    .sort((a, b) => "RCONS".indexOf(a.s) - "RCONS".indexOf(b.s) || a.c.localeCompare(b.c));
  $("stockMsg").textContent = "";
  const ed = canEditPlan();
  $("stBody").innerHTML = list
    .map((x) => {
      const mx = Math.max(x.t.maxi, x.q, 1) * 1.05,
        pos = (v) => Math.min(100, (v / mx) * 100);
      const gauge = `<div class="gauge"><div class="gfill" style="width:${pos(x.q)}%;background:${STAT[x.s].col}"></div><i style="left:${pos(x.t.secu)}%" title="Sécurité"></i><i class="sd" style="left:${pos(x.t.seuil)}%" title="Seuil"></i><i class="mx" style="left:${pos(x.t.maxi)}%" title="Maxi"></i></div>`;
      return `<tr data-c="${esc(x.c)}"><td>${esc(x.c)}</td><td>${esc(x.d)}</td><td>${esc(x.adr || "–")}</td><td><span class="chip" style="background:${STAT[x.s].col}">${STAT[x.s].lab}</span></td>
      <td class="n"><b>${fmt0(x.q)}</b></td><td class="gcell">${gauge}</td>
      <td class="n">${fmt0(x.t.mini)}</td><td class="n">${fmt0(x.t.secu)}</td><td class="n">${fmt0(x.t.seuil)}</td><td class="n">${fmt0(x.t.maxi)}</td>
      <td class="n">${x.cov === null ? "–" : fmt0(x.cov) + " j"}</td><td class="n">${fmtE(x.val)}</td>
      ${ed ? `<td class="act stact"><button type="button" data-mv="E">Entrée</button><button type="button" data-mv="S">Sortie</button><button type="button" data-mv="A">Inventaire</button><button type="button" data-sl="1">Seuils</button></td>` : ""}</tr>`;
    })
    .join("");
  $("stActTh").style.display = ed ? "" : "none";
  if (STOCKS.colorMode === "stock") apply();
  if (selected) select(selected, selPiece);
  if (document.body.dataset.page === "stock" && typeof renderLogParts === "function") renderLogParts();
}

// ----- mouvements -----
function openMv(c, t) {
  if (!canEditPlan()) return;
  $("mvCode").value = c || "";
  [...document.querySelectorAll('input[name="mvType"]')].forEach((i) => (i.checked = i.value === (t || "S")));
  $("mvQty").value = "";
  $("mvDate").value = todayISO();
  $("mvNote").value = "";
  $("mvErr").textContent = "";
  mvPreview();
  $("mvModal").hidden = false;
  setTimeout(() => ($("mvCode").value ? $("mvQty") : $("mvCode")).focus(), 30);
}
function mvPreview() {
  const c = $("mvCode").value.trim(),
    t = (document.querySelector('input[name="mvType"]:checked') || {}).value,
    q = parseFloat(($("mvQty").value || "").replace(",", ".")),
    r = REFS.find((x) => x.c === c);
  if (!STOCK0[c]) {
    $("mvInfo").innerHTML = c ? "Code inconnu dans le plan de rangement." : "Choisissez une référence.";
    return;
  }
  const cur = LEVELS[c] ?? STOCK0[c].q,
    aft = isNaN(q) ? cur : t === "E" ? cur + q : t === "S" ? cur - q : q,
    s1 = statusOf(c, cur),
    s2 = statusOf(c, aft);
  $("mvInfo").innerHTML =
    `<b>${esc(c)}</b> ${esc(r ? r.d : "")}<br>Stock actuel : <b>${fmt0(cur)} m</b> <span class="chip" style="background:${STAT[s1].col}">${STAT[s1].lab}</span>` +
    (isNaN(q)
      ? ""
      : `<br>Après le mouvement : <b>${fmt0(aft)} m</b> <span class="chip" style="background:${STAT[s2].col}">${STAT[s2].lab}</span>`);
}
async function saveMv() {
  const c = $("mvCode").value.trim(),
    t = (document.querySelector('input[name="mvType"]:checked') || {}).value,
    q = parseFloat(($("mvQty").value || "").replace(",", "."));
  const err = (m) => {
    $("mvErr").textContent = m;
  };
  if (!STOCK0[c]) return err("Choisissez une référence du plan de rangement.");
  if (isNaN(q) || q < 0 || (q === 0 && t !== "A")) return err("Indiquez une quantité positive, en mètres.");
  const cur = LEVELS[c] ?? STOCK0[c].q;
  if (t === "S" && q > cur + 1e-6) return err(`Sortie impossible : il n’y a que ${fmt0(cur)} m en stock.`);
  const m = {
    c,
    t,
    qty: Math.round(q * 10) / 10,
    at: Date.now(),
    d: $("mvDate").value.split("-").reverse().join("/"),
    note: $("mvNote").value.trim().slice(0, 200),
    by: STOCKS.uid || "",
  };
  $("mvSave").disabled = true;
  try {
    if (STOCKS.db) {
      await STOCKS.db.collection("stockmvt").add(m);
    } else {
      STOCKS.mvts.push(m);
      STOCKS.hist.unshift(m);
      store.set("at1-stock", { seuils: STOCKS.seuils, mvts: STOCKS.mvts });
      renderStock();
    }
    $("mvModal").hidden = true;
    planMsg(`${{ E: "Entrée", S: "Sortie", A: "Inventaire" }[t]} enregistrée pour ${c}.`);
  } catch (e) {
    err("Enregistrement refusé : vos droits ne permettent pas de saisir un mouvement.");
  }
  $("mvSave").disabled = false;
}
// ----- seuils -----
function openSeuils(c) {
  if (!canEditPlan()) return;
  const t = seuilsOf(c),
    r = REFS.find((x) => x.c === c);
  $("slCode").textContent = `${c} ${r ? r.d : ""}`;
  $("slModal").dataset.c = c;
  ["mini", "secu", "seuil", "maxi"].forEach((k) => ($("sl_" + k).value = Math.round(t[k])));
  $("slErr").textContent = "";
  $("slModal").hidden = false;
}
async function saveSeuils() {
  const c = $("slModal").dataset.c,
    v = {};
  for (const k of ["mini", "secu", "seuil", "maxi"]) {
    const n = parseFloat(($("sl_" + k).value || "").replace(",", "."));
    if (isNaN(n) || n < 0) {
      $("slErr").textContent = "Valeurs positives uniquement.";
      return;
    }
    v[k] = n;
  }
  if (v.seuil < v.secu || v.maxi < v.seuil) {
    $("slErr").textContent = "Il faut sécurité ≤ seuil ≤ maxi.";
    return;
  }
  const next = { ...STOCKS.seuils, [c]: v };
  try {
    if (STOCKS.db) await STOCKS.db.doc("stockcfg/seuils").set({ s: next, at: Date.now() });
    else {
      STOCKS.seuils = next;
      store.set("at1-stock", { seuils: STOCKS.seuils, mvts: STOCKS.mvts });
      renderStock();
    }
    $("slModal").hidden = true;
    planMsg(`Seuils mis à jour pour ${c}.`);
  } catch (e) {
    $("slErr").textContent = "Enregistrement refusé.";
  }
}
// ----- export Excel -----
async function exportStock() {
  if (!window.XLSX) {
    planMsg("Le module Excel n’est pas chargé.", true);
    return;
  }
  recompute();
  const head = [
    "Code",
    "Désignation",
    "Adresse",
    "Statut",
    "Stock (m)",
    "Stock mini (m)",
    "Stock de sécurité (m)",
    "Seuil de réappro (m)",
    "Stock maxi (m)",
    "Couverture (jours)",
    "Coût unitaire (€/m)",
    "Valeur (€)",
    "Délai d'appro (jours)",
  ];
  const rows = Object.keys(STOCK0).map((c) => {
    const r = REFS.find((x) => x.c === c),
      b = STOCK0[c],
      q = LEVELS[c],
      t = seuilsOf(c),
      s = statusOf(c, q);
    return [
      c,
      r ? r.d : "",
      r
        ? piecesOf(c)
            .map((p) => addr(p.z, p.s))
            .join(", ")
        : "",
      STAT[s].lab,
      Math.round(q),
      Math.round(t.mini),
      Math.round(t.secu),
      Math.round(t.seuil),
      Math.round(t.maxi),
      b.conso > 0 ? Math.round(q / (b.conso / 365)) : "",
      b.cu,
      Math.round(q * b.cu),
      Math.round(b.del),
    ];
  });
  const wb = XLSX.utils.book_new(),
    ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
  ws["!cols"] = head.map((h, i) => ({ wch: i === 1 ? 34 : i === 2 ? 22 : 14 }));
  ws["!autofilter"] = { ref: "A1:M" + (rows.length + 1) };
  XLSX.utils.book_append_sheet(wb, ws, "Stock");
  const TL = { E: "Entrée", S: "Sortie", A: "Inventaire" },
    mv = [["Date", "Code", "Type", "Quantité (m)", "Commentaire"]].concat(
      STOCKS.hist.map((m) => [m.d, m.c, TL[m.t], m.qty, m.note || ""]),
    );
  const wm = XLSX.utils.aoa_to_sheet(mv);
  wm["!cols"] = [12, 12, 12, 14, 40].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wm, "Mouvements");
  const d = new Date(),
    fn = `Stock_AT1_${d.toISOString().slice(0, 10)}.xlsx`;
  try {
    await saveFile(
      fn,
      new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    planMsg(`Export : ${fn}`);
  } catch (e) {
    planMsg("Export impossible sur cet appareil.", true);
  }
}
// ----- données partagées (lien claude.ai) ou locales -----
async function initStock(db, user) {
  STOCKS.db = db || null;
  STOCKS.user = user || null;
  if (user) {
    try {
      STOCKS.uid = await user.id();
    } catch (e) {}
  }
  if (!db) {
    const loc = MODE === "consultation" ? null : store.get("at1-stock");
    if (loc) {
      STOCKS.seuils = loc.seuils || {};
      STOCKS.mvts = loc.mvts || [];
      STOCKS.hist = STOCKS.mvts.slice().sort((a, b) => b.at - a.at);
    }
    STOCKS.ready = true;
    renderStock();
    return;
  }
  const names = async () => {
    if (!STOCKS.user) return;
    const ids = [...new Set(STOCKS.hist.map((m) => m.by).filter(Boolean))];
    if (!ids.length) return;
    try {
      const ps = await STOCKS.user.profiles(ids);
      ids.forEach((id) => (STOCKS.names[id] = (ps[id] && ps[id].name) || ""));
    } catch (e) {}
  };
  db.doc("stockcfg/seuils").onSnapshot(
    (s) => {
      STOCKS.seuils = (s.exists && s.data().s) || {};
      renderStock();
    },
    () => {},
  );
  db.doc("stockcfg/base").onSnapshot(
    (s) => {
      const b = s.exists ? s.data() : null;
      STOCKS.base = b ? b.q : null;
      STOCKS.baseAt = b ? b.at : 0;
      if (STOCKS.unsub) STOCKS.unsub();
      STOCKS.unsub = db
        .collection("stockmvt")
        .where("at", ">", STOCKS.baseAt)
        .orderBy("at", "asc")
        .limit(1000)
        .onSnapshot(
          (q) => {
            STOCKS.mvts = q.docs.map((d) => d.data());
            renderStock();
            consolidate();
          },
          () => {},
        );
    },
    () => {},
  );
  db.collection("stockmvt")
    .orderBy("at", "desc")
    .limit(300)
    .onSnapshot(
      async (q) => {
        STOCKS.hist = q.docs.map((d) => d.data());
        await names();
        renderStock();
      },
      () => {},
    );
  STOCKS.ready = true;
}
let consolidating = false;
async function consolidate() {
  // au-delà de 800 mouvements depuis la dernière clôture, un éditeur enregistre une photo du stock
  if (consolidating || ROLE !== "editor" || !STOCKS.db || STOCKS.mvts.length < 800) return;
  consolidating = true;
  try {
    recompute();
    const lastAt = Math.max(...STOCKS.mvts.map((m) => m.at));
    await STOCKS.db.doc("stockcfg/base").set({ q: LEVELS, at: lastAt });
  } catch (e) {}
  consolidating = false;
}
// ----- onglets de page et événements -----
function setPage(p) {
  document.body.dataset.page = p;
  [
    ["tabMaq", "maq"],
    ["tabStock", "stock"],
    ["tabLog", "log"],
  ].forEach(([id, v]) => $(id).setAttribute("aria-selected", String(p === v)));
  if (p === "stock") renderStock();
  else if (p === "log") etqRender();
  else resize();
}
const pageFromHash = () =>
  location.hash === "#stock"
    ? "stock"
    : location.hash === "#etiquettes" || location.hash === "#logistique"
      ? "log"
      : "maq";
$("tabMaq").addEventListener("click", () => {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  setPage("maq");
});
$("tabStock").addEventListener("click", () => {
  location.hash = "stock";
});
$("tabLog").addEventListener("click", () => {
  location.hash = "etiquettes";
});
window.addEventListener("hashchange", () => {
  if (!openFromHash()) setPage(pageFromHash());
});
["stSearch", "stStatus", "stZone"].forEach((id) =>
  $(id).addEventListener(id === "stSearch" ? "input" : "change", renderStock),
);
$("stExport").addEventListener("click", exportStock);
$("mvNew").addEventListener("click", () => openMv("", "S"));
$("stBody").addEventListener("click", (e) => {
  const b = e.target.closest("button"),
    tr = e.target.closest("tr[data-c]");
  if (!b || !tr) return;
  if (b.dataset.mv) openMv(tr.dataset.c, b.dataset.mv);
  else if (b.dataset.sl) openSeuils(tr.dataset.c);
});
["mvCode", "mvQty"].forEach((id) => $(id).addEventListener("input", mvPreview));
document.querySelectorAll('input[name="mvType"]').forEach((i) => i.addEventListener("change", mvPreview));
$("mvCancel").addEventListener("click", () => ($("mvModal").hidden = true));
$("mvSave").addEventListener("click", saveMv);
$("slCancel").addEventListener("click", () => ($("slModal").hidden = true));
$("slSave").addEventListener("click", saveSeuils);
$("colorMode").addEventListener("change", (e) => {
  STOCKS.colorMode = e.target.value;
  store.set("at1-color", STOCKS.colorMode);
  renderLegend();
  recompute();
  apply();
});
$("mvCode").innerHTML =
  `<option value="">Choisir une référence…</option>` +
  Object.keys(STOCK0)
    .sort()
    .map((c) => {
      const r = REFS.find((x) => x.c === c);
      return `<option value="${esc(c)}">${esc(c)} · ${esc(r ? r.d : "")}</option>`;
    })
    .join("");
function stockBoot() {
  STOCKS.colorMode = store.get("at1-color") === "stock" ? "stock" : "abc";
  $("colorMode").value = STOCKS.colorMode;
  recompute();
  renderLegend();
  if (!openFromHash()) setPage(pageFromHash());
}

/* ---------- Mode terrain et inventaire tournant ---------- */
const ARTIFACT_URL = "https://claude.ai/artifact/NaFAkaLKQzQVmgwvh2mFe8";
const FREQ = { A: 30, B: 90, C: 180, "Sans historique": 180 };
const DAY = 864e5,
  dstr = (t) => new Date(t).toLocaleDateString("fr-FR");
const qrBase = () =>
  store.get("at1-qrbase") ||
  (IN_CLAUDE && !MODE
    ? ARTIFACT_URL
    : /^https?:/.test(location.protocol)
      ? location.origin + location.pathname
      : ARTIFACT_URL);
// ----- mode terrain -----
function terrainShow(item) {
  const box = $("tCard");
  let r = null,
    ps = [],
    here = "";
  if (item.c) {
    r = REFS.find((x) => x.c === item.c);
    ps = piecesOf(item.c);
  } else {
    here = addr(item.z, item.s);
    const p = PIECES.find((x) => x.z === item.z && x.s === item.s);
    if (p) {
      r = p.r;
      ps = piecesOf(r.c);
    }
  }
  if (!r) {
    box.innerHTML = `<div class="taddr">${esc(here)}</div><div class="tsub">${ZLAB[item.z] || ""}</div><p class="tempty">Emplacement libre.</p>`;
    return;
  }
  recompute();
  const q = LEVELS[r.c] ?? (STOCK0[r.c] ? STOCK0[r.c].q : 0),
    s = STOCK0[r.c] ? statusOf(r.c, q) : "N";
  const adrs = ps.map((p) => addr(p.z, p.s)),
    next = countDue(r);
  box.innerHTML = `<div class="taddr">${esc(here || adrs[0] || "–")}</div>${adrs.length > 1 ? `<div class="tsub">Aussi : ${esc(adrs.filter((a) => a !== (here || adrs[0])).join(", "))}</div>` : ""}
    <div class="tref"><b>${esc(r.c)}</b> · ${esc(r.d)}</div>
    <div class="tgrid"><div><span>Stock</span><b>${fmt0(q)} m</b></div><div><span>Statut</span><b><span class="chip" style="background:${STAT[s].col}">${STAT[s].lab}</span></b></div>
      <div><span>Longueur</span><b>${r.l} m</b></div><div><span>Classe</span><b>${esc(KLAB[r.k] || r.k)}</b></div><div><span>Prochain comptage</span><b>${dstr(next)}</b></div></div>
    <div class="tbtns"><button type="button" class="tbtn e" data-tmv="E">Entrée</button><button type="button" class="tbtn s" data-tmv="S">Sortie</button><button type="button" class="tbtn a" data-tmv="A">Inventaire</button></div>`;
  box.dataset.c = r.c;
}
// ----- inventaire tournant -----
function hashCode(c) {
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
const CYCLE_START = new Date(2026, 10, 2).getTime(); // lundi 2 novembre 2026
function countDue(r) {
  const f = FREQ[r.k] || 180,
    e = ECARTS[r.c];
  return e ? e.at + f * DAY : CYCLE_START + (hashCode(r.c) % f) * DAY;
}
function weekEnd() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  d.setDate(d.getDate() + (7 - (d.getDay() || 7)));
  return d.getTime();
}
function renderInventaire() {
  recompute();
  const end = weekEnd(),
    now = Date.now();
  const list = REFS.filter((r) => STOCK0[r.c])
    .map((r) => ({
      r,
      due: countDue(r),
      adr: piecesOf(r.c)
        .map((p) => addr(p.z, p.s))
        .join(", "),
    }))
    .filter((x) => x.due <= end)
    .sort((a, b) => a.due - b.due || a.adr.localeCompare(b.adr));
  const ed = canEditPlan();
  $("invTbl").innerHTML =
    `<thead><tr><th>Adresse</th><th>Code</th><th>Désignation</th><th>Classe</th><th>Stock théorique (m)</th><th>Échéance</th>${ed ? "<th></th>" : ""}</tr></thead><tbody>` +
    (list.length
      ? list
          .map(
            (
              x,
            ) => `<tr><td>${esc(x.adr || "–")}</td><td>${esc(x.r.c)}</td><td>${esc(x.r.d)}</td><td>${esc(x.r.k)}</td><td class="n">${fmt0(LEVELS[x.r.c] ?? 0)}</td>
      <td>${x.due < now - DAY ? `<span class="chip" style="background:#E03131">En retard</span> ` : ""}${dstr(x.due)}</td>${ed ? `<td class="act"><button type="button" data-cnt="${esc(x.r.c)}">Compter</button></td>` : ""}</tr>`,
          )
          .join("")
      : `<tr><td colspan="7">Rien à compter cette semaine.</td></tr>`) +
    "</tbody>";
}
function fillTerrainList() {
  const v = $("tSelect").value,
    zo = { P: 0, M: 1, E: 2 };
  const rows = REFS.map((r) => ({ r, ps: piecesOf(r.c).sort((a, b) => zo[a.z] - zo[b.z] || a.s - b.s) })).sort((a, b) =>
    a.r.c.localeCompare(b.r.c),
  );
  $("tSelect").innerHTML =
    `<option value="">Choisir une référence…</option>` +
    rows
      .map(
        (x) =>
          `<option value="${esc(x.r.c)}">${esc(x.r.c)} · ${esc(x.r.d)}${x.ps.length ? " · " + esc(x.ps.map((p) => addr(p.z, p.s)).join(", ")) : ""}</option>`,
      )
      .join("");
  $("tSelect").value = v;
}
$("tSelect").addEventListener("change", () => {
  if ($("tSelect").value) terrainShow({ c: $("tSelect").value });
});
function renderLogParts() {
  fillTerrainList();
  renderInventaire();
  if ($("tCard").dataset.c) terrainShow({ c: $("tCard").dataset.c });
}
$("tCard").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tmv]");
  if (b && $("tCard").dataset.c) openMv($("tCard").dataset.c, b.dataset.tmv);
});
$("invTbl").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-cnt]");
  if (b) openMv(b.dataset.cnt, "A");
});
function openFromHash() {
  const m = location.hash.match(/^#emp-([A-Za-z0-9-]+)$/);
  if (!m) return false;
  const a = parseAddr(m[1]);
  if (!a) return false;
  setPage("stock");
  terrainShow({ z: a.z, s: a.s });
  $("tCard").scrollIntoView({ block: "center" });
  return true;
}

/* ---------- Étiquettes ---------- */
const ETQ = { list: [], i: 0, zone: "", zoom: 100, edits: {}, W: 1200, H: 410, qr: new Map(), busy: false };
function etqFillAdr() {
  const occ = occupied();
  $("etqAdr").innerHTML = ETQ.list
    .map((e) => {
      const a = addr(e.z, e.s),
        p = occ[e.z].get(e.s);
      return `<option value="${a}">${a}${p ? " · " + esc(p.r.c) : " · libre"}</option>`;
    })
    .join("");
}
function etqBuild() {
  ETQ.list = [];
  ["P", "M", "E"].forEach((z) => {
    if (ETQ.zone && ETQ.zone !== z) return;
    for (let s = 1; s <= CAP[z]; s++) {
      if (z !== "P" && hiddenRacks.has(z + cantSlot(s).t)) continue;
      ETQ.list.push({ z, s });
    }
  });
  ETQ.i = Math.min(ETQ.i, ETQ.list.length - 1);
  if (ETQ.i < 0) ETQ.i = 0;
  etqFillAdr();
}
function etqData(e) {
  const a = addr(e.z, e.s),
    m = a.match(/^(.*)-(\d{3})$/),
    k = e.z !== "P" ? cantSlot(e.s) : null;
  return { adr: a, texte: a, ...(ETQ.edits[a] || {}) };
}
function etqQRText(d) {
  return qrBase() + "#emp-" + d.adr;
}
function etqQR(text) {
  if (ETQ.qr.has(text)) return ETQ.qr.get(text);
  if (typeof qrcode === "undefined") return null;
  const qr = qrcode(0, "H");
  qr.addData(text);
  qr.make();
  ETQ.qr.set(text, qr);
  return qr;
}
function etqDessiner(ctx, w, h, d, sc, apercu = false) {
  const ins = 10 * sc,
    rad = 26 * sc;
  const cadre = () => {
    ctx.beginPath();
    ctx.moveTo(ins + rad, ins);
    ctx.arcTo(w - ins, ins, w - ins, h - ins, rad);
    ctx.arcTo(w - ins, h - ins, ins, h - ins, rad);
    ctx.arcTo(ins, h - ins, ins, ins, rad);
    ctx.arcTo(ins, ins, w - ins, ins, rad);
    ctx.closePath();
  };
  if (apercu) {
    ctx.clearRect(0, 0, w, h);
    cadre();
    ctx.fillStyle = "white";
    ctx.fill();
  } else {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
  }
  cadre();
  ctx.lineWidth = 7 * sc;
  ctx.strokeStyle = "black";
  ctx.stroke(); // cadre aux coins arrondis
  const qr = etqQR(etqQRText(d)),
    qrSize = Math.round(h * 0.7),
    qrX = w - qrSize - 45 * sc,
    qrY = (h - qrSize) / 2;
  ctx.fillStyle = "black";
  if (qr) {
    const n = qr.getModuleCount(),
      cell = qrSize / n;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) ctx.fillRect(qrX + c * cell, qrY + r * cell, cell + 0.5, cell + 0.5);
  }
  // adresse en caractères gras et étroits, ajustée à la place disponible à gauche du QR code
  const x0 = 50 * sc,
    zone = qrX - 40 * sc - x0,
    size = h * 0.62;
  ctx.font = `bold ${size}px Arial`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const tw = ctx.measureText(d.texte || "").width,
    fx = Math.min(0.78, zone / tw);
  ctx.save();
  ctx.translate(x0, h / 2 + size * 0.04);
  ctx.scale(fx, 1);
  ctx.fillText(d.texte || "", 0, 0);
  ctx.restore();
}
function etqRender() {
  if (!$("etqCanvas")) return;
  if (!ETQ.list.length) etqBuild();
  const e = ETQ.list[ETQ.i];
  if (!e) return;
  const d = etqData(e);
  const cv = $("etqCanvas");
  cv.width = ETQ.W;
  cv.height = ETQ.H;
  etqDessiner(cv.getContext("2d"), ETQ.W, ETQ.H, d, 1, true);
  cv.style.transform = `scale(${ETQ.zoom / 100})`;
  $("etqZoomTxt").textContent = ETQ.zoom + "%";
  $("etqPos").value = ETQ.i + 1;
  $("etqTot").textContent = ETQ.list.length;
  $("etqAdr").value = d.adr;
  $("etqTexte").value = d.texte;
  document
    .querySelectorAll("#etqZones button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.z === ETQ.zone)));
}
function etqCanvasAt(d) {
  const sc = ETQ.zoom / 100,
    W = Math.round(ETQ.W * sc),
    H = Math.round(ETQ.H * sc),
    t = document.createElement("canvas");
  t.width = W;
  t.height = H;
  etqDessiner(t.getContext("2d"), W, H, d, sc);
  return t;
}
const etqJpg = (cv) => new Promise((res) => cv.toBlob(res, "image/jpeg", 0.95));
async function etqUne() {
  const e = ETQ.list[ETQ.i];
  if (!e) return;
  const d = etqData(e);
  try {
    await saveFile(`Etiquette_${d.adr}.jpg`, await etqJpg(etqCanvasAt(d)));
  } catch (err) {
    planMsg("Téléchargement impossible sur cet appareil.", true);
  }
}
async function etqMasse() {
  if (ETQ.busy || !ETQ.list.length) return;
  if (!window.JSZip) {
    planMsg("Module de compression non chargé : vérifiez la connexion Internet.", true);
    return;
  }
  ETQ.busy = true;
  $("etqUne").disabled = $("etqTout").disabled = true;
  $("etqProg").hidden = false;
  const zip = new JSZip(),
    tot = ETQ.list.length,
    zname = { "": "tous", P: "portique", M: "milieu", E: "est" }[ETQ.zone];
  try {
    for (let i = 0; i < tot; i++) {
      const d = etqData(ETQ.list[i]);
      zip.file(`Etiquette_${d.adr}.jpg`, await etqJpg(etqCanvasAt(d)));
      if (i % 4 === 0 || i === tot - 1) {
        $("etqProgTxt").textContent = `${i + 1} / ${tot}`;
        $("etqProgBar").style.width = ((i + 1) / tot) * 100 + "%";
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    $("etqProgTxt").textContent = "Compression…";
    await saveFile(`Etiquettes_emplacements_${zname}.zip`, await zip.generateAsync({ type: "blob" }));
  } catch (err) {
    planMsg("Génération impossible sur cet appareil.", true);
  }
  $("etqProg").hidden = true;
  $("etqUne").disabled = $("etqTout").disabled = false;
  ETQ.busy = false;
}
function etqGo(i) {
  ETQ.i = Math.max(0, Math.min(ETQ.list.length - 1, i));
  etqRender();
}
document.querySelectorAll("#etqZones button").forEach((b) =>
  b.addEventListener("click", () => {
    ETQ.zone = b.dataset.z;
    ETQ.i = 0;
    etqBuild();
    etqRender();
  }),
);
$("etqFirst").addEventListener("click", () => etqGo(0));
$("etqPrev").addEventListener("click", () => etqGo(ETQ.i - 1));
$("etqNext").addEventListener("click", () => etqGo(ETQ.i + 1));
$("etqLast").addEventListener("click", () => etqGo(ETQ.list.length - 1));
$("etqPos").addEventListener("change", () => etqGo((parseInt($("etqPos").value, 10) || 1) - 1));
$("etqAdr").addEventListener("change", () => {
  const a = parseAddr($("etqAdr").value);
  if (!a) return etqRender();
  if (ETQ.zone && ETQ.zone !== a.z) {
    ETQ.zone = "";
    etqBuild();
  }
  const i = ETQ.list.findIndex((x) => x.z === a.z && x.s === a.s);
  if (i >= 0) etqGo(i);
  else etqRender();
});
[["etqTexte", "texte"]].forEach(([id, k]) =>
  $(id).addEventListener("input", () => {
    const e = ETQ.list[ETQ.i];
    if (!e) return;
    const a = addr(e.z, e.s);
    ETQ.edits[a] = { ...(ETQ.edits[a] || {}), [k]: $(id).value };
    etqRender();
  }),
);
$("etqZoomMoins").addEventListener("click", () => {
  ETQ.zoom = Math.max(25, ETQ.zoom - 25);
  etqRender();
});
$("etqZoomPlus").addEventListener("click", () => {
  ETQ.zoom = Math.min(200, ETQ.zoom + 25);
  etqRender();
});
$("etqZoomReset").addEventListener("click", () => {
  ETQ.zoom = 100;
  etqRender();
});
$("etqUne").addEventListener("click", etqUne);
$("etqTout").addEventListener("click", etqMasse);

/* ---------- Droits ---------- */
function showUpdated(at) {
  const t = $("roleTxt");
  if (!t || !at) return;
  const d = new Date(at);
  t.dataset.upd = ` Plan mis à jour le ${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`;
  paintRole();
}
function pubTxt() {
  if (!PUBLISHED || !PUBLISHED.at) return " Plan publié : plan de rangement du classeur.";
  const d = new Date(PUBLISHED.at);
  return ` Plan publié le ${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`;
}
function paintRole() {
  const t = $("roleTxt"),
    u = t.dataset.upd || "";
  t.textContent =
    ROLE === "editor"
      ? "Mode édition : vos modifications sont enregistrées pour tous les lecteurs." + u
      : MODE === "edition"
        ? "Page d’édition : vos changements sont un brouillon sur ce PC. Pour les publier, exportez plan.js et déposez-le sur GitHub." +
          pubTxt()
        : MODE === "consultation"
          ? "Consultation : lecture seule." + pubTxt()
          : ROLE === "local"
            ? "Mode local : fichier ouvert sur cet appareil, modifications gardées ici."
            : "Mode consultation : lecture seule. Seuls les éditeurs peuvent modifier le plan." + u;
  $("thAddr").textContent = canEditPlan() ? "Adresse (toucher pour déplacer)" : "Adresse";
  document.querySelectorAll("[data-rack]").forEach((b) => {
    b.disabled = !canEditPlan();
    b.setAttribute("aria-pressed", String(!hiddenRacks.has(b.dataset.rack)));
  });
}
function setRole(r) {
  ROLE = r;
  document.body.dataset.role = r;
  if (!canEditPlan() && moving) stopMove();
  paintRole();
  renderTable();
  renderMoves();
  if (typeof renderStock === "function") renderStock();
  if (selected) select(selected, selPiece);
}
function applyState(st) {
  stopMove && moving && stopMove();
  bundles.slice().forEach((o) => removeMesh(o.userData.p));
  PIECES.length = 0;
  REFS.length = 0;
  (st.refs || []).forEach((r) => REFS.push({ ...r }));
  (st.pieces || []).forEach((p) => {
    const r = REFS.find((x) => x.c === p.c);
    if (r) PIECES.push({ id: p.id, r, z: p.z, s: p.s });
  });
  REFS.forEach(syncN);
  PIECES.forEach(addMesh);
  hiddenRacks.clear();
  (st.hidden || []).forEach((k) => hiddenRacks.add(k));
  if (selected && !REFS.find((r) => r.c === selected)) select(null);
  rebuildFree();
  refreshCodes();
  apply();
  renderTable();
  paintRole();
}
async function initRole() {
  document.body.dataset.mode = MODE;
  if (MODE) {
    setRole(MODE === "consultation" ? "viewer" : "local");
    initStock(null, null);
    return;
  }
  if (!IN_CLAUDE) {
    setRole("local");
    initStock(null, null);
    return;
  }
  let user = null,
    db = null,
    ed = false;
  try {
    user = await window.claude.use("user");
    ed = user ? await user.canEdit() : false;
  } catch (e) {
    ed = false;
  }
  try {
    db = await window.claude.use("db");
  } catch (e) {
    db = null;
  }
  setRole(ed && db ? "editor" : "viewer");
  initStock(db, user);
  if (!db) return;
  DOC = db.doc("plan/etat");
  let first = true;
  DOC.onSnapshot(
    (snap) => {
      if (snap.exists) {
        const st = snap.data();
        showUpdated(st.at);
        if (st.rev && st.rev === lastRev) {
          first = false;
          return;
        }
        applyState(st);
      } else {
        const t = $("roleTxt");
        t.dataset.upd = "";
        applyState({ ...FILE_STATE, hidden: [] });
      }
      first = false;
    },
    () => {},
  );
}

/* ---------- Vues ---------- */
const VIEWS = {
  global: [new THREE.Vector3(55, 62, 70), new THREE.Vector3(96, 0, 2)],
  P: [new THREE.Vector3(98, 26, 40), new THREE.Vector3(117, 0, 4)],
  M: [new THREE.Vector3(88, 12, 24), new THREE.Vector3(94, 2, ROW_Z.M)],
  E: [new THREE.Vector3(88, 12, -28), new THREE.Vector3(94, 2, ROW_Z.E)],
};
let mode = "global",
  anim = null,
  userMoved = false;
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HINT = {
  global: "Glisser pour tourner, molette ou pincement pour zoomer, toucher un fardeau pour le détail.",
  plan: "Glisser pour déplacer le plan, molette ou pincement pour zoomer, toucher un fardeau pour le détail.",
  walk: "Cliquer au sol pour s’y rendre, molette pour avancer ou reculer, glisser pour regarder autour. Clavier et joystick restent possibles.",
};
function flyTo(pos, tgt) {
  if (reduce) {
    pcam.position.copy(pos);
    controls.target.copy(tgt);
    return;
  }
  anim = { p0: pcam.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt, k: 0 };
}
const walk = {
  pos: new THREE.Vector3(100.8, 1.7, 26.4),
  yaw: 0,
  pitch: -0.05,
  keys: {},
  joy: { x: 0, y: 0 },
  target: null,
};
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const goRing = new THREE.Mesh(
  new THREE.RingGeometry(0.35, 0.55, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.9, depthWrite: false }),
);
goRing.visible = false;
scene.add(goRing);
const lookAtYaw = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
function setMode(m) {
  mode = m;
  $("hint").textContent = HINT[m];
  walk.target = null;
  if (typeof goRing !== "undefined") goRing.visible = false;
  $("joy").classList.toggle("on", m === "walk" && window.matchMedia("(pointer: coarse)").matches);
  controls.enabled = m === "global";
  ocontrols.enabled = m === "plan";
  anim = null;
  G.sky.visible = m !== "plan";
  if (m === "plan") {
    camera = ocam;
    ocam.position.set(0, 200, 0);
    ocam.up.set(0, 0, -1);
    ocontrols.target.set(0, 0, 0);
    ocam.zoom = 1;
    ocam.lookAt(0, 0, 0);
    scene.background = new THREE.Color(0xdde2e6);
    resize();
  } else {
    scene.background = null;
    camera = pcam;
    pcam.up.set(0, 1, 0);
    if (m === "walk") {
      pcam.fov = 70;
      walk.pos.set(100.8, 1.7, 26.4);
      walk.yaw = lookAtYaw(walk.pos, new THREE.Vector3(93, 0, -2));
      walk.pitch = -0.05;
    } else pcam.fov = 48;
    pcam.updateProjectionMatrix();
  }
  applyWeather();
  scaleCotes();
}
function scaleCotes() {
  const f = mode === "plan" ? 2.4 : 1;
  G.cotes.children.forEach((o) => {
    o.visible = !(mode === "plan" && o.userData.elev);
    if (o.isSprite && o.userData.base) o.scale.set(o.userData.base[0] * f, o.userData.base[1] * f, 1);
  });
}
function setView(v) {
  document
    .querySelectorAll(".views button")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.view === v || (!["plan", "walk", "global"].includes(v) && b.dataset.view === "global")),
      ),
    );
  if (v === "plan" || v === "walk") {
    setMode(v);
    return;
  }
  if (mode !== "global") setMode("global");
  userMoved = v !== "global";
  const vv = v === "global" ? globalView() : VIEWS[v];
  flyTo(vv[0].clone(), vv[1].clone());
  $("fZone").value = ["P", "M", "E"].includes(v) ? v : "";
  apply();
}
document.querySelectorAll(".views button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
function focusOn(o, p) {
  if (mode === "plan") {
    ocontrols.target.set(o.position.x, 0, o.position.z);
    ocam.position.set(o.position.x, 200, o.position.z);
    ocam.zoom = Math.max(ocam.zoom, 6);
    ocam.updateProjectionMatrix();
    return;
  }
  if (mode === "walk") {
    const q = o.position;
    walk.pos.set(q.x + (p.z === "P" ? -18 : 0), 1.7, q.z + (p.z === "P" ? 0 : p.z === "M" ? 9 : -9));
    walk.yaw = lookAtYaw(walk.pos, q);
    walk.pitch = p.z === "P" ? -0.05 : Math.atan2(q.y - 1.7, 9) * 0.8;
    return;
  }
  flyTo(
    o.position
      .clone()
      .add(p.z === "P" ? new THREE.Vector3(-12, 10, 10) : new THREE.Vector3(6, 4.5, p.z === "M" ? 10 : -10)),
    o.position.clone(),
  );
}

/* ---------- Interaction ---------- */
const ray = new THREE.Raycaster(),
  ptr = new THREE.Vector2(),
  tip = $("tip");
let down = null,
  drag = null;
function pick(ev) {
  const rc = canvas.getBoundingClientRect();
  ptr.x = ((ev.clientX - rc.left) / rc.width) * 2 - 1;
  ptr.y = -((ev.clientY - rc.top) / rc.height) * 2 + 1;
  ray.setFromCamera(ptr, camera);
  const targets = bundles
    .filter((b) => b.visible && G.charges.visible)
    .concat(moving ? freeMeshes.filter((m) => m.visible) : []);
  const hit = ray.intersectObjects(targets, false)[0];
  return hit ? hit.object : null;
}
let dragP = null,
  dragging = false;
function endDrag() {
  dragP = null;
  dragging = false;
  controls.enabled = mode === "global";
  ocontrols.enabled = mode === "plan";
  canvas.style.cursor = "";
}
stage.addEventListener(
  "pointerdown",
  (e) => {
    // en capture : décide avant les commandes de caméra si l’on saisit un fardeau
    if (e.target !== canvas || mode === "walk" || !canEditPlan() || moving || e.button > 0) return;
    const o = pick(e);
    if (o && o.userData.p) {
      dragP = o.userData.p;
      controls.enabled = false;
      ocontrols.enabled = false;
    }
  },
  true,
);
canvas.addEventListener("pointerdown", (e) => {
  down = { x: e.clientX, y: e.clientY };
  if (mode === "walk") {
    drag = { x: e.clientX, y: e.clientY, yaw: walk.yaw, pitch: walk.pitch };
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener("pointerup", (e) => {
  drag = null;
  if (dragging) {
    const p = dragP,
      o = pick(e);
    endDrag();
    if (o && (o.userData.free || (o.userData.p && o.userData.p !== p))) tryTarget(o);
    else stopMove("Déplacement annulé.");
    return;
  }
  if (dragP) endDrag();
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const o = pick(e);
  if (moving) {
    if (o) tryTarget(o);
    return;
  }
  if (o && o.userData.p) {
    select(o.userData.p.r.c, o.userData.p);
    return;
  }
  if (mode === "walk") {
    const pt = new THREE.Vector3();
    if (ray.ray.intersectPlane(groundPlane, pt) && pt.distanceTo(walk.pos) < 120) {
      walk.target = new THREE.Vector3(pt.x, 1.7, pt.z);
      goRing.position.set(pt.x, 0.05, pt.z);
      goRing.visible = true;
    }
    return;
  }
  select(null);
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (mode !== "walk") return;
    e.preventDefault();
    walk.target = null;
    goRing.visible = false;
    const step = -Math.sign(e.deltaY) * 1.2;
    walk.pos.x += -Math.sin(walk.yaw) * step;
    walk.pos.z += -Math.cos(walk.yaw) * step;
  },
  { passive: false },
);
canvas.addEventListener("pointermove", (e) => {
  if (dragP && !dragging && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
    dragging = true;
    startMove(dragP);
    banner(
      `Glissez ${dragP.r.c} vers un emplacement libre en vert, ou sur un autre fardeau pour échanger, puis relâchez.`,
    );
  }
  if (dragging) {
    const o = pick(e),
      rc = stage.getBoundingClientRect();
    canvas.style.cursor = "grabbing";
    if (o && (o.userData.free || o.userData.p)) {
      tip.innerHTML = o.userData.free
        ? `Vers ${addr(o.userData.z, o.userData.s)}`
        : `Échanger avec ${o.userData.p.r.c} (${addr(o.userData.p.z, o.userData.p.s)})`;
      tip.style.display = "block";
      tip.style.left = Math.min(e.clientX - rc.left + 14, rc.width - tip.offsetWidth - 8) + "px";
      tip.style.top = e.clientY - rc.top + 14 + "px";
    } else tip.style.display = "none";
    return;
  }
  if (mode === "walk" && drag) {
    walk.yaw = drag.yaw - (e.clientX - drag.x) * 0.005;
    walk.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch - (e.clientY - drag.y) * 0.004));
    return;
  }
  if (e.pointerType !== "mouse") return;
  const o = pick(e);
  if (!o) {
    tip.style.display = "none";
    canvas.style.cursor = "";
    return;
  }
  const rc = stage.getBoundingClientRect();
  tip.innerHTML = o.userData.free
    ? `Emplacement libre<br>${addr(o.userData.z, o.userData.s)}`
    : `<b>${o.userData.p.r.c}</b>, ${o.userData.p.r.d}<br>${addr(o.userData.p.z, o.userData.p.s)}`;
  tip.style.display = "block";
  canvas.style.cursor = "pointer";
  tip.style.left = Math.min(e.clientX - rc.left + 14, rc.width - tip.offsetWidth - 8) + "px";
  tip.style.top = e.clientY - rc.top + 14 + "px";
});
canvas.addEventListener("pointerleave", () => (tip.style.display = "none"));
window.addEventListener("pointercancel", () => {
  if (dragging) stopMove();
  if (dragP) endDrag();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && moving) stopMove();
  if (mode === "walk" && !/INPUT|SELECT/.test(document.activeElement.tagName)) {
    walk.keys[e.key.toLowerCase()] = true;
    if (e.key.startsWith("Arrow")) e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  walk.keys[e.key.toLowerCase()] = false;
});
const joy = $("joy"),
  knob = $("knob");
let jid = null;
function joyMove(e) {
  const r = joy.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2),
    dy = e.clientY - (r.top + r.height / 2);
  const m = Math.hypot(dx, dy),
    max = r.width / 2 - 20;
  if (m > max) {
    dx *= max / m;
    dy *= max / m;
  }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  walk.joy.x = dx / max;
  walk.joy.y = dy / max;
}
joy.addEventListener("pointerdown", (e) => {
  jid = e.pointerId;
  joy.setPointerCapture(jid);
  joyMove(e);
  e.stopPropagation();
});
joy.addEventListener("pointermove", (e) => {
  if (e.pointerId === jid) joyMove(e);
});
const joyEnd = () => {
  jid = null;
  knob.style.transform = "";
  walk.joy.x = walk.joy.y = 0;
};
joy.addEventListener("pointerup", joyEnd);
joy.addEventListener("pointercancel", joyEnd);

// emprise réelle du site (bâtiments, toitures, zones au sol, portique) : sert au cadrage
let _sb = null;
function siteBox() {
  if (_sb) return _sb;
  let x0 = 1e9,
    x1 = -1e9,
    z0 = 1e9,
    z1 = -1e9;
  const add = (x, z) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  };
  SITE.walls.forEach((w) => {
    add(w[0], w[1]);
    add(w[2], w[3]);
  });
  SITE.roofs.forEach((r) => r.p.forEach((p) => add(p[0], p[1])));
  add(70.9, -20);
  add(126, 28); // zone des cantilevers (les voies et zones lointaines ne comptent pas dans le cadrage)
  add(POR.x0, POR.zs);
  add(POR.x0 + POR.w, POR.zs - POR.n * POR.pitch);
  return (_sb = { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, bw: x1 - x0, bd: z1 - z0 });
}
// plan 2D : le site couvre toute la largeur de la zone d'affichage (on coupe plutôt que de laisser du vide)
function fitPlan(a = stage.clientWidth / stage.clientHeight) {
  const b = siteBox();
  const hh = Math.max((b.bd / 2) * 1.02, ((b.bw / 2) * 1.02) / a),
    hw = hh * a;
  ocam.left = -hw;
  ocam.right = hw;
  ocam.top = hh;
  ocam.bottom = -hh;
  ocam.zoom = 1;
  ocam.updateProjectionMatrix();
  ocam.position.set(b.cx, 200, b.cz);
  ocontrols.target.set(b.cx, 0, b.cz);
  ocam.lookAt(b.cx, 0, b.cz);
}
// 3D globale : distance calculée pour que le site remplisse la largeur de l'écran
function globalView(a = stage.clientWidth / stage.clientHeight) {
  const b = siteBox(),
    tv = Math.tan(THREE.MathUtils.degToRad(pcam.fov / 2)),
    th = tv * a;
  const T = new THREE.Vector3(96, 0, 2),
    dir = new THREE.Vector3(-0.45, 0.62, 0.64).normalize(),
    fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(),
    up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  let R = 0,
    U = 0;
  [20, 134].forEach((x) =>
    [b.z0, b.z1].forEach((z) =>
      [0, 6].forEach((y) => {
        const v = new THREE.Vector3(x - T.x, y, z - T.z);
        R = Math.max(R, Math.abs(v.dot(right)));
        U = Math.max(U, Math.abs(v.dot(up)));
      }),
    ),
  );
  const d = Math.max(R / (th * 0.97), U / (tv * 0.97), 20);
  return [T.clone().add(dir.multiplyScalar(d)), T];
}
function resize() {
  const w = stage.clientWidth,
    h = stage.clientHeight;
  renderer.setSize(w, h, false);
  pcam.aspect = w / h;
  pcam.updateProjectionMatrix();
  if (mode === "plan") fitPlan();
  else if (mode === "global" && !userMoved && !anim) {
    const [p, t] = globalView();
    pcam.position.copy(p);
    controls.target.copy(t);
  }
}
new ResizeObserver(resize).observe(stage);
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (document.body.dataset.page && document.body.dataset.page !== "maq") return; // autre page affichée : la 3D est en pause
  if (document.hidden) return; // onglet caché : la 3D est en pause
  if (!reduce) {
    clouds.forEach((c, i) => {
      if (!c.visible) return;
      c.position.x += dt * (0.6 + (i % 5) * 0.15);
      if (c.position.x > 380) c.position.x = -260;
    });
    if (rain.visible) {
      const a = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN_N; i++) {
        const j = i * 6;
        a[j + 1] -= dt * 28;
        a[j + 4] -= dt * 28;
        if (a[j + 4] < 0) {
          a[j + 1] += 60;
          a[j + 4] += 60;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
  }
  if (mode === "walk") {
    const k = walk.keys,
      f = (k["arrowup"] || k["z"] || k["w"] ? 1 : 0) - (k["arrowdown"] || k["s"] ? 1 : 0) - walk.joy.y,
      st = (k["arrowright"] || k["d"] ? 1 : 0) - (k["arrowleft"] || k["q"] || k["a"] ? 1 : 0) + walk.joy.x;
    const sp = (k["shift"] ? 7 : 3.2) * dt,
      fx = -Math.sin(walk.yaw),
      fz = -Math.cos(walk.yaw);
    if (f || st) {
      walk.target = null;
      goRing.visible = false;
    }
    walk.pos.x += (fx * f - fz * st) * sp;
    walk.pos.z += (fz * f + fx * st) * sp;
    if (walk.target) {
      const dx = walk.target.x - walk.pos.x,
        dz = walk.target.z - walk.pos.z,
        d = Math.hypot(dx, dz);
      if (d < 0.25) {
        walk.target = null;
        goRing.visible = false;
      } else {
        const want = Math.atan2(-dx, -dz);
        let da = want - walk.yaw;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        walk.yaw += da * Math.min(1, dt * 4);
        const v = Math.min(d, 4.2 * dt);
        walk.pos.x += (dx / d) * v;
        walk.pos.z += (dz / d) * v;
      }
    }
    pcam.position.copy(walk.pos);
    pcam.lookAt(
      walk.pos.x + fx * Math.cos(walk.pitch),
      walk.pos.y + Math.sin(walk.pitch),
      walk.pos.z + fz * Math.cos(walk.pitch),
    );
  } else if (mode === "global") {
    if (anim) {
      anim.k = Math.min(1, anim.k + 0.045);
      const e = 1 - Math.pow(1 - anim.k, 3);
      pcam.position.lerpVectors(anim.p0, anim.p1, e);
      controls.target.lerpVectors(anim.t0, anim.t1, e);
      if (anim.k >= 1) anim = null;
    }
    controls.update();
  } else ocontrols.update();
  sky.position.copy(pcam.position);
  renderer.render(scene, camera);
}
pcam.position.copy(VIEWS.global[0]);
controls.target.copy(VIEWS.global[1]);
resize();
setMode("global");
stockBoot();
apply();
renderTable();
requestAnimationFrame(loop);
paintRole();
initRole();
Promise.all(["pickup", "trailer", "bike"].map(loadGLB))
  .then(([pickup, trailer, bike]) => buildVehicles({ pickup, trailer, bike }))
  .catch(() => buildVehicles(null));
if (window.matchMedia("(max-width: 900px)").matches)
  document.querySelectorAll("details.sidecard").forEach((d) => (d.open = false));
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => {
  makeLabels();
  scaleCotes();
});
