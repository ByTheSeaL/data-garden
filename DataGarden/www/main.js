// Data Garden — warm, physics-driven 3D crypto garden.
// Each coin: glowing sphere. Size = 24h volume, height = 24h % change,
// colour = amber (up) / slate (down). Hand-rolled spring physics.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

// ---------- scene setup ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x231a14);              // warm bark
scene.fog = new THREE.FogExp2(0x231a14, 0.018);            // soft depth fade

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 8, 46);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 8;
controls.maxDistance = 140;

// ---------- lighting ----------
scene.add(new THREE.AmbientLight(0xffe4c4, 0.35));
const key = new THREE.PointLight(0xffb066, 60, 200);
key.position.set(0, 20, 0);
scene.add(key);
const rim = new THREE.PointLight(0x6f7a8a, 25, 200);       // faint cool rim
rim.position.set(-30, -10, -20);
scene.add(rim);

// ---------- warm dust / starfield ----------
const DUST_COUNT = 900;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustCol = new Float32Array(DUST_COUNT * 3);
const warm = new THREE.Color(0xd9a05c), cool = new THREE.Color(0x8d99a6);
for (let i = 0; i < DUST_COUNT; i++) {
  // scatter in a big slow-rotating shell
  const r = 60 + Math.random() * 120;
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  dustPos[i*3]   = r * Math.sin(ph) * Math.cos(th);
  dustPos[i*3+1] = (r * Math.cos(ph)) * 0.6;
  dustPos[i*3+2] = r * Math.sin(ph) * Math.sin(th);
  const c = Math.random() < 0.8 ? warm : cool;
  dustCol[i*3] = c.r; dustCol[i*3+1] = c.g; dustCol[i*3+2] = c.b;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.7, vertexColors: true, transparent: true, opacity: 0.55,
  sizeAttenuation: true, depthWrite: false
}));
scene.add(dust);

// ---------- glow sprite texture (radial gradient, generated once) ----------
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,230,190,0.55)');
  grad.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = makeGlowTexture();

// ---------- coin planets ----------
const COINS = ['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','XRPUSDT','ADAUSDT'];
const AMBER_UP  = new THREE.Color(0xd9a05c);
const SLATE_DN  = new THREE.Color(0x7d8794);

const planets = {}; // symbol -> {group, mesh, glow, labelEl, physics, data}

function labelFor(sym) {
  const div = document.createElement('div');
  div.className = 'label';
  div.innerHTML = `<span class="sym"></span><span class="px"></span><span class="chg"></span>`;
  document.getElementById('labels').appendChild(div);
  return div;
}

function createPlanet(sym) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 40, 40);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9a05c, emissive: 0x8a5a22, emissiveIntensity: 0.55,
    roughness: 0.45, metalness: 0.15
  });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  // soft bloom-ish halo sprite
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc987, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.65
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(4.5);
  group.add(glow);

  scene.add(group);
  return {
    sym,
    group, mesh, glow,
    label: labelFor(sym),
    // physics state: velocity + spring toward an anchor height
    vel: new THREE.Vector3(),
    anchorY: 0,
    radius: 2.2,
    data: null,           // last Binance ticker
    momentum: 0           // smoothed price-change momentum
  };
}
COINS.forEach(sym => planets[sym] = createPlanet(sym));

// ---------- data from C# shell ----------
// window.updateData(jsonArray) — array of Binance 24hr tickers
window.updateData = function (arr) {
  const now = new Date();
  document.getElementById('hud-updated').textContent =
    'last update: ' + now.toLocaleTimeString();
  updateStatus({ ok: true });       // pass an object - updateStatus expects {ok:bool}
  for (const t of arr) {
    const p = planets[t.symbol];
    if (!p) continue;
    p.data = t;
  }
};

// window.updateStatus({ok:bool}) — connection state
window.updateStatus = function (s) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (s && s.ok) {
    dot.className = 'dot ok';
    txt.textContent = 'connected · Binance';
  } else {
    dot.className = 'dot bad';
    txt.textContent = 'reconnecting…';
  }
};

// ---------- physics helpers ----------
const WORLD_R = 26;         // ring radius where planets orbit
const HEIGHT_SCALE = 0.9;   // % change -> world units

function targetColor(pct) {
  // warm amber for up, cool slate for down; blend by strength of move
  const t = Math.min(Math.abs(pct) / 8, 1);           // normalise ~0..1
  const c = pct >= 0 ? AMBER_UP.clone() : SLATE_DN.clone();
  return c.lerp(pct >= 0 ? new THREE.Color(0xffd9a0) : new THREE.Color(0xaeb9c6), t * 0.5);
}

function updateFromData(p) {
  if (!p.data) return;
  const pct = parseFloat(p.data.priceChangePercent) || 0;
  const vol = parseFloat(p.data.quoteVolume) || 0;
  const price = parseFloat(p.data.lastPrice) || 0;

  // size: log-scaled volume so BTC doesn't dwarf everything
  const target = 1.6 + Math.log10(Math.max(vol, 1)) * 0.35;
  p.radius += (target - p.radius) * 0.04;             // ease size

  // anchor height from 24h change (up rises)
  p.anchorY = THREE.MathUtils.clamp(pct * HEIGHT_SCALE, -14, 14);

  // colour ease toward target
  const col = targetColor(pct);
  p.mesh.material.color.lerp(col, 0.05);
  p.mesh.material.emissive.copy(col).multiplyScalar(0.45);
  p.glow.material.color.copy(col).lerp(new THREE.Color(0xffffff), 0.25);

  // label text
  p.label.querySelector('.sym').textContent = p.data.symbol;
  p.label.querySelector('.px').textContent = fmtPrice(price);
  const chg = p.label.querySelector('.chg');
  chg.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  chg.className = 'chg ' + (pct >= 0 ? 'up' : 'down');

  // momentum: quick smoothed delta of pct — drives gentle upward pull
  const inst = pct - (p.prevPct ?? pct);
  p.prevPct = pct;
  p.momentum += (THREE.MathUtils.clamp(inst, -2, 2) * 0.2 - p.momentum) * 0.02;
}

function fmtPrice(v) {
  if (v >= 1000) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1)    return '$' + v.toFixed(2);
  return '$' + v.toFixed(4);
}

// gentle mutual repulsion so spheres never overlap
function applyRepulsion(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const d = new THREE.Vector3().subVectors(a.group.position, b.group.position);
      const dist = d.length() || 0.001;
      const min = a.radius + b.radius + 2.5;
      if (dist < min) {
        const push = d.normalize().multiplyScalar((min - dist) * 0.02);
        a.vel.add(push); b.vel.sub(push);
      }
    }
  }
}

// ---------- animation loop ----------
const clock = new THREE.Clock();
const planetList = Object.values(planets);

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta(), 0.05);

  for (const p of planetList) {
    updateFromData(p);

    // slow orbit around the centre ring
    const ang = p.startAng + t * p.orbitSpeed;
    const orbitX = Math.cos(ang) * WORLD_R;
    const orbitZ = Math.sin(ang) * WORLD_R;

    // spring toward anchor height + momentum drift; damping everywhere
    const pos = p.group.position;
    pos.x += (orbitX - pos.x) * 0.03;
    pos.z += (orbitZ - pos.z) * 0.03;
    const spring = (p.anchorY + p.momentum * 6 - pos.y) * 0.015;
    p.vel.y += spring;
    p.vel.multiplyScalar(0.94);              // damping
    pos.addScaledVector(p.vel, dt * 60);

    // gentle breathing bob for life
    pos.y += Math.sin(t * 0.8 + p.startAng * 2) * 0.002;

    p.mesh.scale.setScalar(p.radius);
    p.glow.scale.setScalar(p.radius * 3.6);

    // project label to screen space
    const v = pos.clone().project(camera);
    const sx = (v.x * 0.5 + 0.5) * innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * innerHeight;
    p.label.style.left = sx + 'px';
    p.label.style.top  = (sy - p.radius * 10) + 'px';
    p.label.style.display = v.z < 1 ? 'block' : 'none';
  }

  applyRepulsion(planetList);
  dust.rotation.y = t * 0.005;               // slow drift
  key.position.y = 18 + Math.sin(t * 0.3) * 2;

  controls.update();
  renderer.render(scene, camera);
}

// give each planet a starting angle/speed so orbits are staggered
planetList.forEach((p, i) => {
  p.startAng = (i / planetList.length) * Math.PI * 2;
  p.orbitSpeed = 0.05 + Math.random() * 0.03;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

animate();