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
    add(0.42, 0.18, 0.05, lamp, sg * 0.92, 1.3,
