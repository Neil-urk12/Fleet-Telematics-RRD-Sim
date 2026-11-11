// 3D garage car picker, ported from the "Bay Nine" three.js r128 prototype to three 0.170.
// Kept: garage, lift turntable with floor reflection, orbit camera, camera views, thumbnails.
// Removed on purpose: intro, engine/audio, headlights, drive-out, photo mode, paint configurator.
// Plain JS (typed by scene.d.ts): the procedural geometry code is a port, not app logic.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const EASE = {
  inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  in: t => t * t * t,
  lin: t => t,
  outBack: t => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};
const wrapPi = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

/* Lights in three r155+ are physical. Convert the prototype's legacy-mode values so each light
   reads the same at the distance d it mostly lights (legacy falloff vs inverse-power falloff). */
const phys = (i, dist, decay, d) => i * Math.PI * Math.pow(Math.max(0, 1 - d / dist), decay) * Math.pow(d, decay);

/* ---------- vehicle → body ---------- */
// Known catalog models (MODELS) get their own silhouette; any other name falls back to the two generic bodies.
export const BODY_LABEL = { lumen: 'Sedan / crossover', basalt: 'Truck / SUV', sedan: 'Sedan', hatch: 'Hatchback', crossover: 'Crossover', pickup: 'Pickup truck', suv: 'SUV', van: 'Cargo van' };
const specFor = model => MODELS.find(m => m.re.test(model));
export function bodyFor(model) {
  return specFor(model)?.body ?? (/f-?150|silverado|r1t|r1s|truck|pickup|van|suv/i.test(model) ? 'basalt' : 'lumen');
}
const defFor = model => specFor(model)?.def ?? BODIES[bodyFor(model)];

/* ---------- canvas helpers ---------- */
function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h); return c;
}
function speckle(g, w, h, n, cols, rMin, rMax, aMin, aMax) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = rand(aMin, aMax);
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rand(rMin, rMax), 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}
function wear(g, w, h, n) {
  g.save(); g.globalCompositeOperation = 'destination-out';
  speckle(g, w, h, n, ['#000'], 0.5, 3.2, 0.25, 0.9);
  for (let i = 0; i < n / 40; i++) { g.globalAlpha = rand(.15, .5); g.lineWidth = rand(.5, 2); g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + rand(-60, 60), y + rand(-8, 8)); g.stroke(); }
  g.restore();
}
function uvMeters(geo, sx, sy, tile = 1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx / tile, uv.getY(i) * sy / tile);
  uv.needsUpdate = true; return geo;
}

/* ---------- geometry helpers ---------- */
// monotone cubic interpolation over [s, value] keys (no overshoot)
function curve(keys) {
  const n = keys.length, xs = keys.map(k => k[0]), ys = keys.map(k => k[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return s => {
    if (s <= xs[0]) return ys[0]; if (s >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (s > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (s - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
function ringPoint(sec, th, s, out) {
  const c = Math.cos(th), sn = Math.sin(th), e = 2 / sec.n;
  const sx = Math.sign(c) * Math.pow(Math.abs(c), e), sy = Math.sign(sn) * Math.pow(Math.abs(sn), e);
  const mid = (sec.b + sec.t) / 2, h = (sec.t - sec.b) / 2;
  const wx = sec.w * (sy > 0 ? 1 - sec.tumble * sy * sy : 1 - sec.tuck * sy * sy);
  out.set(sx * wx, mid + sy * h, s); return out;
}
function loft(sMin, sMax, N, M, secAt, ends, groupFn) {
  const pos = new Float32Array(N * M * 3); const v = new THREE.Vector3();
  const stations = [];
  for (let i = 0; i < N; i++) { const u = i / (N - 1); stations.push(sMin + (sMax - sMin) * (u - 0.72 * Math.sin(2 * Math.PI * u) / (2 * Math.PI))); }
  stations.forEach((s, i) => {
    const sec = Object.assign({}, secAt(s));
    let k = 1, pv = 0.5;
    if (s > sMax - ends.rf) { const u = (s - (sMax - ends.rf)) / ends.rf; k = Math.sqrt(Math.max(0, 1 - u * u)); pv = ends.pf; }
    else if (s < sMin + ends.rr) { const u = ((sMin + ends.rr) - s) / ends.rr; k = Math.sqrt(Math.max(0, 1 - u * u)); pv = ends.pr; }
    if (k < 1) { const c = sec.b + pv * (sec.t - sec.b); sec.t = c + (sec.t - c) * k; sec.b = c + (sec.b - c) * k; sec.w *= Math.pow(k, 0.7); }
    for (let j = 0; j < M; j++) { ringPoint(sec, j / M * Math.PI * 2 - Math.PI / 2 + 0.0001, s, v); pos.set([v.x, v.y, v.z], (i * M + j) * 3); }
  });
  const g0 = [], g1 = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + (j + 1) % M, d = (i + 1) * M + j;
    const tgt = groupFn && groupFn((stations[i] + stations[i + 1]) / 2, j + 0.5) ? g1 : g0;
    tgt.push(a, b, d, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(g0.concat(g1));
  geo.addGroup(0, g0.length, 0); if (g1.length) geo.addGroup(g0.length, g1.length, 1);
  geo.computeVertexNormals();
  return geo;
}
const _rc = new THREE.Raycaster();
function hit(mesh, o, dir) {
  _rc.set(o, dir); _rc.far = 20;
  const h = _rc.intersectObject(mesh, false)[0];
  if (!h) return null;
  const n = h.face.normal.clone();
  if (n.dot(dir) > 0) n.negate();
  return { p: h.point.clone(), n };
}
function ribbon(mesh, origins, dir, spread, halfW, mat, off = 0.006) {
  const hits = origins.map(o => hit(mesh, o, dir)).filter(Boolean);
  if (hits.length < 2) return null;
  const pos = [], uv = [], idx = [];
  hits.forEach((h, i) => {
    const u = spread.clone().sub(h.n.clone().multiplyScalar(h.n.dot(spread))).normalize();
    const base = h.p.clone().addScaledVector(h.n, off);
    const a = base.clone().addScaledVector(u, halfW), b = base.clone().addScaledVector(u, -halfW);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z); const t = i / (hits.length - 1); uv.push(t, 1, t, 0);
  });
  for (let i = 0; i < hits.length - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.userData.hits = hits; return m;
}
function patch(mesh, nu, nv, originAt, dir, mat, off = 0.005) {
  const grid = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) grid.push(hit(mesh, originAt(i / nu, j / nv), dir));
  for (let k = 0; k < grid.length; k++) if (!grid[k]) { const f = grid.find(Boolean); if (!f) return null; grid[k] = f; }
  const pos = [], uv = [], idx = [];
  grid.forEach((h, k) => { const p = h.p.clone().addScaledVector(h.n, off); pos.push(p.x, p.y, p.z); uv.push((k % (nu + 1)) / nu, Math.floor(k / (nu + 1)) / nv); });
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1; idx.push(a, b, c, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
function orientTo(obj, n) { obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); }
function makeTireGeo(r, w, rimR) {
  const pts = []; const sh = Math.min(0.065, w * 0.25), mid = (rimR + r - sh) / 2;
  pts.push(new THREE.Vector2(rimR, -w / 2 + 0.015));
  pts.push(new THREE.Vector2(rimR + 0.015, -w / 2));
  pts.push(new THREE.Vector2(mid, -w / 2 - 0.012));
  pts.push(new THREE.Vector2(r - sh, -w / 2));
  for (let i = 1; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + Math.sin(a) * sh, -w / 2 + sh - Math.cos(a) * sh)); }
  for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(mid, w / 2 + 0.012));
  pts.push(new THREE.Vector2(rimR + 0.015, w / 2));
  pts.push(new THREE.Vector2(rimR, w / 2 - 0.015));
  const g = new THREE.LatheGeometry(pts, 56);
  g.rotateZ(Math.PI / 2);
  return g;
}

/* ---------- bodies ---------- */
const BODIES = {
  lumen: {
    fam: 'lumen', paints: [0xebedef, 0x0c0d10, 0x5cb6b1, 0xc49a3c, 0x4a2e8e, 0xe56e58],
    finish: { metalness: 0.04, roughness: 0.16, clearcoat: 1, cr: 0.02 },
    rim: { hex: 0x3a3d43, m: .9, r: .3 }, caliper: 0xf0b512, rimStyle: 'aero',
    geo: {
      sMin: -2.56, sMax: 2.42, rf: 0.55, rr: 0.35, pf: 0.3, pr: 0.5, sill: 0.19, r: 0.34, tw: 0.27, axF: 1.5, axR: -1.44, archGap: 0.04,
      top: [[-2.56, 0.66], [-2.35, 0.80], [-1.9, 0.86], [-1.0, 0.88], [0.0, 0.88], [0.9, 0.86], [1.55, 0.8], [2.1, 0.68], [2.42, 0.48]],
      width: [[-2.56, 0.6], [-2.2, 0.82], [-1.4, 0.97], [0.0, 0.99], [1.5, 0.98], [2.1, 0.9], [2.42, 0.7]],
      flareF: 0.03, flareR: 0.05, n: 3.0, tumble: 0.22, tuck: 0.2, track: 0.845, trackR: 0.855, doors: [1.0, -0.5],
      gh: { roof: [[-2.2, 0.80], [-1.8, 0.96], [-1.2, 1.13], [-0.5, 1.27], [0.0, 1.29], [0.5, 1.17], [1.1, 0.80]], width: [[-2.2, 0.42], [-1.4, 0.64], [-0.4, 0.76], [0.4, 0.76], [1.1, 0.70]], n: 2.6, tumble: 0.5, roofPaint: null, mirrorS: 0.95 }
    },
    build(a, M) {
      a.strip(1, 0.64, -0.9, 0.9, 0.012, 'head');
      a.grille(1, -0.55, 0.55, 0.24, 0.3, M.grilleHoney, 10, 2);
      a.strip(-1, 0.74, -0.86, 0.86, 0.014, 'tail');
      a.grille(-1, -0.7, 0.7, 0.22, 0.32, M.carbon, 8, 2);
      a.plate(0.5);
      a.mirrorX(sx => a.sideStripe(sx, -2.2, 2.2, 0.3, 0.06, M.carbon));
    }
  },
  basalt: {
    fam: 'basalt', paints: [0xb9a079, 0x535a3b, 0xe5e9ec, 0x8a3a1c, 0x3c4249, 0xd0601b],
    finish: { metalness: 0.3, roughness: 0.56, clearcoat: 0.12, cr: 0.55 },
    rim: { hex: 0x101113, m: .5, r: .2 }, caliper: 0x18191b, rimStyle: 'steel',
    geo: {
      sMin: -2.38, sMax: 2.55, rf: 0.18, rr: 0.14, pf: 0.5, pr: 0.5, sill: 0.6, r: 0.46, tw: 0.33, axF: 1.58, axR: -1.42, archGap: 0.07, boxFlare: true, rimRatio: 0.62,
      top: [[-2.38, 1.16], [-2.28, 1.33], [-1.0, 1.36], [0.0, 1.36], [0.9, 1.35], [1.6, 1.28], [2.3, 1.24], [2.55, 1.08]],
      width: [[-2.38, 0.94], [-2.15, 0.97], [2.25, 0.97], [2.55, 0.93]],
      flareF: 0.07, flareR: 0.07, n: 7, tumble: 0.06, tuck: 0.12, track: 0.85, doors: [0.85, -0.45, -1.5],
      gh: { roof: [[-2.3, 1.30], [-2.24, 1.86], [-2.0, 1.95], [0.0, 1.96], [0.4, 1.92], [0.92, 1.30]], width: [[-2.3, 0.86], [0.92, 0.86]], n: 7, tumble: 0.1, roofPaint: [[-2.1, 0.32, 1.1]], mirrorS: 0.82 }
    },
    build(a, M) {
      const V = THREE.Vector3;
      a.mirrorX(sx => a.round(1, sx * 0.7, 1.0, 0.11, 'head'));
      a.grille(1, -0.5, 0.5, 0.82, 1.15, M.grilleSlats);
      a.box(2.02, 0.22, 0.2, M.matteBlack, 0, 0.66, 2.6);
      a.mirrorX(sx => a.box(0.08, 0.06, 0.1, new THREE.MeshStandardMaterial({ color: 0xd2261c, roughness: .4 }), sx * 0.55, 0.62, 2.72));
      a.box(1.2, 0.04, 0.5, M.disc, 0, 0.5, 2.35, 0.3);
      a.box(2.0, 0.2, 0.18, M.matteBlack, 0, 0.7, -2.44);
      a.mirrorX(sx => a.sideStripe(sx, -2.3, 2.48, 0.72, 0.1, M.matteBlack));
      a.mirrorX(sx => a.box(0.05, 0.05, 2.35, M.matteBlack, sx * 0.76, 2.06, -0.85));
      for (let z = -1.95; z <= 0.25; z += 0.55) a.box(1.58, 0.035, 0.05, M.matteBlack, 0, 2.05, z);
      a.mirrorX(sx => [-1.95, -0.85, 0.25].forEach(z => a.box(0.06, 0.1, 0.06, M.matteBlack, sx * 0.76, 2.0, z)));
      a.box(1.32, 0.1, 0.09, M.matteBlack, 0, 2.12, 0.34);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.055), a.lampMat('head')); bar.position.set(0, 2.12, 0.386); a.add(bar);
      a.glow('head', [-0.5, 0, 0.5].map(x => ({ p: new V(x, 2.12, 0.4), n: new V(0, 0, 1) })));
      const sp = new THREE.Group(); sp.position.set(0, 1.05, -2.6);
      const tire = new THREE.Mesh(makeTireGeo(0.44, 0.3, 0.28), M.rubber); tire.rotation.y = Math.PI / 2; sp.add(tire);
      const hubc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.24, 28), a.car.mats.rim); hubc.rotation.x = Math.PI / 2; sp.add(hubc);
      a.add(sp);
      a.mirrorX(sx => { a.round(-1, sx * 0.84, 1.06, 0.055, 'tail'); a.round(-1, sx * 0.84, 1.2, 0.055, 'tail'); a.round(-1, sx * 0.84, 0.93, 0.045, 'amber'); });
      a.cyl(0.055, 0.055, 1.05, M.matteBlack, 1.02, 1.6, 0.98);
      a.cyl(0.06, 0.06, 0.22, M.matteBlack, 1.02, 2.12, 1.06, Math.PI / 2);
      a.plate(0.84);
    }
  }
};

/* ---------- known models ---------- */
// Catalog EVs: silhouette from published length / width / height / wheelbase (metres) plus the
// model's light signature. Recognisable proportions, not exact replicas.
// tail: 0 = notchback boot … 1 = upright hatch.
function carGeo({ L, W, H, wb, r, foh, tail, sill = 0.2, n = 3, nose = 0.64, ghN = 2.6, tumble = 0.5, glassRoof }) {
  const sMax = L / 2, sMin = -sMax, axF = sMax - foh, axR = axF - wb, tw = 0.25, hw = W / 2 - 0.04, b = H * 0.64, ws = axF - 0.4;
  const T = (x, y) => lerp(x, y, tail), g0 = sMin + T(0.36, 0.1), cp = sMin + T(0.95, 0.5); // cp: rear pillar
  const roofPaint = [[cp, cp + T(0.16, 0.3), 1.7]];
  if (!glassRoof) roofPaint.push([cp, ws - 0.75, 0.95]);
  return {
    belt: b, hw, sMin, sMax, rf: 0.38, rr: T(0.35, 0.22), pf: 0.42, pr: 0.5, sill, r, tw, axF, axR, archGap: 0.04,
    top: [[sMin, b * T(0.75, 0.9)], [sMin + 0.2, b * T(0.91, 0.98)], [sMin + 0.7, b], [0, b], [axF - 0.6, b * 0.98], [axF + 0.05, b * 0.91], [sMax - 0.32, b * lerp(nose, 0.91, 0.6)], [sMax, b * nose]],
    width: [[sMin, hw * T(0.62, 0.78)], [sMin + 0.36, hw * T(0.84, 0.92)], [sMin + 1.15, hw * 0.98], [0, hw], [axF, hw * 0.99], [sMax - 0.32, hw * 0.95], [sMax, hw * 0.82]],
    flareF: 0.012, flareR: 0.03, n, tumble: 0.22, tuck: 0.2, track: W / 2 - tw / 2 - 0.015, doors: [axF - 0.52, axF - 1.62, axR + 0.4],
    gh: {
      roof: [[g0, b * 0.9], [sMin + T(0.76, 0.5), H * T(0.745, 0.92)], [sMin + 1.36, H * T(0.875, 0.985)], [ws - 1.1, H], [ws - 0.6, H * 0.907], [ws, b * 0.9]],
      width: [[g0, hw * T(0.43, 0.7)], [sMin + 1.16, hw * T(0.65, 0.76)], [-0.4, hw * 0.77], [0.4, hw * 0.77], [ws, hw * 0.71]],
      n: ghN, tumble, roofPaint, mirrorS: ws - 0.15
    }
  };
}
// bed: pickup bed length (0 = roof runs to the tail); sail: painted buttress behind the cab; van: panelled sides.
function boxGeo({ L, W, H, wb, r, foh, belt, nose, bed = 0, sail = 0, wsBack = 0.45, wsRun = 0.7, sill = 0.36, van }) {
  const sMax = L / 2, sMin = -sMax, axF = sMax - foh, axR = axF - wb, tw = 0.3, hw = W / 2 - 0.05;
  const ws = axF - wsBack, roofF = ws - wsRun, cb = sMin + bed + 0.03, d0 = axF - 0.5, d1 = d0 - 1.1, gw = hw * (van ? 0.97 : 0.9);
  const roofPaint = [[van ? sMin - 1 : cb + 0.15, roofF + 0.05, 1.0]];
  if (van) roofPaint.push([sMin - 1, d1, 1.7]);
  if (sail) roofPaint.push([cb - sail - 1, cb + 0.15, 1.7]);
  return {
    belt, nose, hw, bed, sail, sMin, sMax, rf: 0.22, rr: 0.14, pf: 0.5, pr: 0.5, sill, r, tw, axF, axR, archGap: 0.07, boxFlare: true,
    top: [[sMin, belt - 0.03], [sMin + 0.12, belt], [0, belt], [ws, belt - 0.02], [sMax - 0.35, lerp(nose, belt, 0.7)], [sMax, nose]],
    width: [[sMin, hw * 0.96], [sMin + 0.2, hw], [sMax - 0.35, hw], [sMax, hw * 0.93]],
    flareF: 0.05, flareR: 0.05, n: 5, tumble: 0.06, tuck: 0.12, track: W / 2 - tw / 2 - 0.02, doors: [d0, d1, d1 - (van ? 1.3 : 0.95)].concat(bed ? [cb] : []),
    gh: {
      roof: [[cb - sail, belt - 0.06], [cb + 0.07, H * 0.95], [cb + 0.35, H], [roofF - 0.3, H], [roofF, H * 0.97], [ws, belt - 0.06]],
      width: [[cb - sail, gw], [ws, gw]], n: 6, tumble: van ? 0.04 : 0.12, roofPaint, mirrorS: ws - 0.2
    }
  };
}
// lamp helpers: mirrored strips, mirrored patches
const eyes = (a, end, y, x0, x1, h, kind) => a.mirrorX(sx => a.strip(end, y, sx * x0, sx * x1, h, kind));
const pair = (a, end, x0, x1, y0, y1, mat) => { a.grille(end, x0, x1, y0, y1, mat, 3, 3); a.grille(end, -x1, -x0, y0, y1, mat, 3, 3); };
function carLamps({ bar, barR, band, vTail, tri, thick = 0.028 } = {}) {
  return (a, M) => {
    const { belt: b, hw, sMin, sMax, sill } = a.D, yF = b * 0.72, yR = a.top(sMin) * 0.95, tail = a.lampMat('tail');
    if (band) a.grille(1, -hw * 0.5, hw * 0.5, yF - 0.07, yF + 0.03, M.carbon, 10, 2);
    eyes(a, 1, yF, hw * 0.5, hw * 0.86, thick, 'head');
    if (bar) a.strip(1, yF, -hw * 0.5, hw * 0.5, 0.006, 'head');
    a.grille(1, -hw * 0.55, hw * 0.55, sill + 0.05, sill + 0.13, M.grilleHoney, 10, 2);
    if (vTail) pair(a, -1, hw * 0.66, hw * 0.84, yR - 0.24, yR, tail);
    else if (tri) [0.46, 0.6, 0.74].forEach(k => pair(a, -1, hw * k, hw * (k + 0.09), yR - 0.13, yR + 0.01, tail));
    else eyes(a, -1, yR, hw * 0.45, hw * 0.88, thick + 0.004, 'tail');
    if (barR) a.strip(-1, yR, -hw * 0.45, hw * 0.45, 0.01, 'tail');
    a.grille(-1, -hw * 0.7, hw * 0.7, sill + 0.03, sill + 0.13, M.carbon, 8, 2);
    a.plate(b * 0.56);
    a.mirrorX(sx => a.sideStripe(sx, sMin + 0.35, sMax - 0.3, sill + 0.1, 0.055, M.carbon));
  };
}
function boxLamps({ bar, clamps, ovals, low, van, barR, vTail } = {}) {
  return (a, M) => {
    const { belt, nose, hw, bed, sail, sMin, sMax, sill } = a.D, yF = nose - 0.13, head = a.lampMat('head');
    if (bar) a.strip(1, yF, -hw * 0.86, hw * 0.86, 0.014, 'head');
    if (clamps) { a.grille(1, -hw * 0.68, hw * 0.68, yF - 0.3, yF - 0.04, M.carbon, 10, 3); pair(a, 1, hw * 0.72, hw * 0.9, yF - 0.28, yF - 0.03, head); }
    if (ovals) a.mirrorX(sx => a.round(1, sx * hw * 0.66, yF - 0.02, 0.065, 'head', 2));
    if (low) pair(a, 1, hw * 0.58, hw * 0.9, yF - 0.3, yF - 0.2, head);
    if (van) { a.grille(1, -hw * 0.48, hw * 0.48, nose - 0.42, nose - 0.14, M.grilleSlats); pair(a, 1, hw * 0.56, hw * 0.9, nose - 0.3, nose - 0.14, head); }
    a.grille(1, -hw * 0.9, hw * 0.9, sill + 0.04, sill + 0.2, M.matteBlack, 10, 2);
    if (barR) a.strip(-1, belt - 0.2, -hw * 0.86, hw * 0.86, 0.02, 'tail');
    if (vTail) pair(a, -1, hw * 0.8, hw * 0.94, belt - 0.5, belt - 0.12, a.lampMat('tail'));
    a.grille(-1, -hw * 0.9, hw * 0.9, sill + 0.04, sill + 0.2, M.matteBlack, 10, 2);
    a.plate(belt - 0.55);
    a.mirrorX(sx => a.sideStripe(sx, sMin + 0.3, sMax - 0.3, sill + 0.1, 0.08, M.matteBlack));
    if (bed) { const len = bed - sail - 0.12; a.box(hw * 1.5, 0.04, len, M.matteBlack, 0, belt, sMin + 0.1 + len / 2); } // tonneau cover
  };
}
const known = (re, body, geo, build) => ({ re, body, def: { ...BODIES.lumen, fam: geo.boxFlare ? 'basalt' : 'lumen', geo, build } });
const MODELS = [
  known(/model 3/i, 'sedan', carGeo({ L: 4.69, W: 1.85, H: 1.44, wb: 2.875, r: 0.335, foh: 0.84, tail: 0.3, nose: 0.58, glassRoof: true }), carLamps()),
  known(/model y/i, 'crossover', carGeo({ L: 4.75, W: 1.92, H: 1.62, wb: 2.89, r: 0.355, foh: 0.88, tail: 0.6, sill: 0.23, glassRoof: true }), carLamps()),
  known(/bolt/i, 'hatch', carGeo({ L: 4.145, W: 1.765, H: 1.61, wb: 2.6, r: 0.32, foh: 0.83, tail: 0.95, sill: 0.22, nose: 0.7, ghN: 3 }), carLamps({ band: true })),
  known(/leaf/i, 'hatch', carGeo({ L: 4.49, W: 1.79, H: 1.54, wb: 2.7, r: 0.32, foh: 0.95, tail: 0.8 }), carLamps({ band: true, vTail: true })),
  known(/ioniq 5/i, 'crossover', carGeo({ L: 4.635, W: 1.89, H: 1.605, wb: 3.0, r: 0.37, foh: 0.845, tail: 0.85, sill: 0.23, n: 3.8, nose: 0.72, ghN: 3.6, tumble: 0.34 }), carLamps({ band: true, bar: true, barR: true, thick: 0.045 })),
  known(/ev6/i, 'crossover', carGeo({ L: 4.68, W: 1.88, H: 1.55, wb: 2.9, r: 0.37, foh: 0.86, tail: 0.55, sill: 0.22 }), carLamps({ barR: true })),
  known(/id\.? ?4/i, 'crossover', carGeo({ L: 4.585, W: 1.85, H: 1.64, wb: 2.765, r: 0.37, foh: 0.88, tail: 0.8, sill: 0.23, nose: 0.68, ghN: 3 }), carLamps({ bar: true, barR: true })),
  known(/mach-?e/i, 'crossover', carGeo({ L: 4.71, W: 1.88, H: 1.62, wb: 2.985, r: 0.365, foh: 0.86, tail: 0.5, sill: 0.23 }), carLamps({ tri: true })),
  known(/lightning|f-?150/i, 'pickup', boxGeo({ L: 5.91, W: 2.03, H: 1.99, wb: 3.7, r: 0.42, foh: 0.95, belt: 1.32, nose: 1.18, bed: 1.75 }), boxLamps({ bar: true, clamps: true, barR: true, vTail: true })),
  known(/r1t/i, 'pickup', boxGeo({ L: 5.51, W: 2.08, H: 1.92, wb: 3.45, r: 0.43, foh: 0.9, belt: 1.25, nose: 1.1, bed: 1.45 }), boxLamps({ bar: true, ovals: true, barR: true })),
  known(/r1s/i, 'suv', boxGeo({ L: 5.1, W: 2.08, H: 1.96, wb: 3.075, r: 0.43, foh: 0.9, belt: 1.25, nose: 1.1 }), boxLamps({ bar: true, ovals: true, barR: true })),
  known(/silverado/i, 'pickup', boxGeo({ L: 5.92, W: 2.13, H: 1.99, wb: 3.7, r: 0.44, foh: 0.98, belt: 1.34, nose: 1.16, bed: 1.85, sail: 0.75, wsBack: 0.25, wsRun: 0.95 }), boxLamps({ bar: true, low: true, vTail: true })),
  known(/e-?transit/i, 'van', boxGeo({ L: 5.98, W: 2.06, H: 2.53, wb: 3.75, r: 0.355, foh: 1.02, belt: 1.3, nose: 0.98, wsBack: 0.1, wsRun: 0.85, sill: 0.3, van: true }), boxLamps({ van: true, vTail: true })),
  known(/sprinter/i, 'van', boxGeo({ L: 5.93, W: 2.02, H: 2.62, wb: 3.665, r: 0.385, foh: 1.0, belt: 1.34, nose: 1.02, wsBack: 0.1, wsRun: 0.8, sill: 0.3, van: true }), boxLamps({ van: true, vTail: true }))
];

const R_TT = 3.35, TT_TOP = 0.07;
const VIEWS = {
  hero: { th: 0.62, ph: 1.2, rad: 8.6, y: 0.62 },
  side: { th: Math.PI / 2, ph: 1.47, rad: 8.8, y: 0.7 },
  rear: { th: 2.45, ph: 1.28, rad: 8.4, y: 0.7 },
  top: { th: 0.35, ph: 0.72, rad: 8.4, y: 0.4 }
};
const PH_MIN = 0.3, PH_MAX = 1.52, R_MIN = 4.6, R_MAX = 13;

export function createGarage({ canvas, root, vehicles, catalog = [], startIndex = 0, onUserOrbit, onProgress }) {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let isPhone = canvas.clientWidth <= 760;
  let disposed = false, rafId = 0;
  // Fleet cars, then catalog previews; each one is a long main-thread task.
  let built = 0;
  const total = vehicles.length + catalog.length;
  const progress = () => { if (onProgress && !disposed) onProgress(++built, total); };

  /* tweens */
  const tweens = [];
  const tween = (dur, fn, ez = EASE.inOut) => new Promise(res => tweens.push({ t: 0, dur: Math.max(0.001, dur), fn, ez, res }));
  function updateTweens(dt) {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.ez(k), k);
      if (k >= 1) { tweens.splice(i, 1); tw.res(); }
    }
  }

  /* renderer + scene */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.6 : 1.75));
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070a);
  scene.fog = new THREE.FogExp2(0x06070a, 0.016);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 220);

  function texFrom(c, { srgb = true, repeat = null } = {}) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MAX_ANISO;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  const stdMat = o => new THREE.MeshStandardMaterial(o);

  /* textures */
  const TEX = {};
  TEX.glow = texFrom(makeCanvas(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, 'rgba(255,255,255,.55)');
    gr.addColorStop(.45, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }), { srgb: false });
  TEX.contact = texFrom(makeCanvas(256, 512, (g, w, h) => {
    g.save(); g.translate(w / 2, h / 2); g.scale(1, 2.05);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(.55, 'rgba(0,0,0,.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(-w / 2, -h / 4, w, h / 2); g.restore();
  }), { srgb: false });
  const blobs = [];
  for (let i = 0; i < 260; i++) blobs.push([Math.random(), Math.random(), rand(10, 90), rand(-1, 1)]);
  const floorDraw = rough => (g, w, h) => {
    g.fillStyle = rough ? '#8a8a8a' : '#3b3d40'; g.fillRect(0, 0, w, h);
    blobs.forEach(([x, y, r, s]) => {
      const gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
      const c = rough ? (s > 0 ? 'rgba(255,255,255,' : 'rgba(0,0,0,') : (s > 0 ? 'rgba(90,92,96,' : 'rgba(20,21,23,');
      gr.addColorStop(0, c + (Math.abs(s) * 0.35) + ')'); gr.addColorStop(1, c + '0)');
      g.fillStyle = gr; g.fillRect(x * w - r, y * h - r, r * 2, r * 2);
    });
    speckle(g, w, h, 9000, rough ? ['#fff', '#555'] : ['#55585c', '#232528', '#6a6c70'], .4, 1.4, .15, .5);
    g.strokeStyle = rough ? '#ddd' : '#1a1b1d'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.lineWidth = 1; g.globalAlpha = rough ? .6 : .5;
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 14; k++) { x += rand(-14, 14); y += rand(4, 16); g.lineTo(x, y); } g.stroke(); }
    g.globalAlpha = rough ? .5 : .22; g.strokeStyle = rough ? '#000' : '#0d0e10'; g.lineWidth = 16;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(rand(.2, .8) * w, rand(.2, .8) * h, rand(180, 420), rand(0, 6), rand(0, 6) + 1.2); g.stroke(); }
    g.globalAlpha = 1;
  };
  TEX.floor = texFrom(makeCanvas(1024, 1024, floorDraw(false)), { repeat: [1 / 8, 1 / 8] });
  TEX.floorRough = texFrom(makeCanvas(1024, 1024, floorDraw(true)), { srgb: false, repeat: [1 / 8, 1 / 8] });
  TEX.metal = texFrom(makeCanvas(256, 256, (g, w, h) => {
    for (let x = 0; x < w; x++) { const v = 34 + Math.round(10 * Math.sin(x / w * Math.PI * 8)); g.fillStyle = `rgb(${v},${v + 3},${v + 8})`; g.fillRect(x, 0, 1, h); }
    speckle(g, w, h, 900, ['#5a6068', '#14171b'], .3, 1.2, .1, .4);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, h - 3, w, 3);
    g.fillStyle = 'rgba(200,210,220,.25)'; for (let x = 8; x < w; x += 32) g.fillRect(x, h - 10, 3, 3);
  }), { repeat: [1, 1] });
  TEX.block = texFrom(makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#2f3237'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1f2125'; g.lineWidth = 3;
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); const off = (y / 32) % 2 ? 0 : 64; for (let x = off; x < w; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } }
    speckle(g, w, h, 4000, ['#3c4046', '#25282c'], .4, 1.6, .2, .6);
  }), { repeat: [1, 1] });

  /* environment for reflections */
  const envTex = (() => {
    const s = new THREE.Scene();
    const basic = (c, k = 1) => { const m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }); m.color.multiplyScalar(k); return m; };
    const room = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 34), basic(0x0b0d11)); room.material.side = THREE.BackSide; room.position.y = 5; s.add(room);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), basic(0x1c1e22)); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6; s.add(floor);
    [-4.5, -1.5, 1.5, 4.5].forEach((x, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 16), basic(0xffffff, i === 1 || i === 2 ? 5 : 3.2));
      m.rotation.x = Math.PI / 2; m.position.set(x, 6.5, 0); s.add(m);
    });
    const box = (w, h, col, k, pos, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(col, k)); m.position.copy(pos); m.rotation.y = rotY; s.add(m); };
    box(10, 2.4, 0xcfe0ff, 1.15, new THREE.Vector3(-14, 2.2, 0), Math.PI / 2);
    box(10, 2.4, 0xffe6cc, 0.95, new THREE.Vector3(14, 2.2, 0), -Math.PI / 2);
    box(14, 1.2, 0xffffff, 0.55, new THREE.Vector3(0, 1.4, 16), Math.PI);
    box(6, 0.5, 0xff6a3c, 0.6, new THREE.Vector3(-6, 3.4, -16), 0);
    const pm = new THREE.PMREMGenerator(renderer);
    const t = pm.fromScene(s, 0.035).texture;
    pm.dispose();
    s.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return t;
  })();
  scene.environment = envTex;

  /* shared car materials */
  const M = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06080b, metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7 }),
    trim: stdMat({ color: 0x0b0c0e, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide }),
    matteBlack: stdMat({ color: 0x08090a, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    chrome: stdMat({ color: 0xe8ecf0, roughness: 0.08, metalness: 1, envMapIntensity: 1.6 }),
    rubber: stdMat({ color: 0x111113, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }),
    disc: stdMat({ color: 0x6d7076, roughness: 0.38, metalness: 0.9 }),
    well: stdMat({ color: 0x050506, roughness: 1, side: THREE.DoubleSide }),
    carbon: stdMat({ color: 0x141518, roughness: 0.3, metalness: 0.4, envMapIntensity: 1.2 }),
    grilleHoney: stdMat({ map: texFrom(makeCanvas(256, 128, (g, w, h) => { g.fillStyle = '#050506'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2d33'; g.lineWidth = 2; const s = 9; for (let y = 0; y < h + s; y += s * 1.5) for (let x = 0; x < w + s; x += s * 1.732) { const ox = ((y / (s * 1.5)) % 2) ? s * .866 : 0; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(x + ox + Math.cos(a) * s * .55, y + Math.sin(a) * s * .55); } g.closePath(); g.stroke(); } })), roughness: .5, metalness: .4, side: THREE.DoubleSide }),
    grilleSlats: stdMat({ map: texFrom(makeCanvas(256, 128, (g, w, h) => { g.fillStyle = '#050506'; g.fillRect(0, 0, w, h); for (let x = 6; x < w; x += 18) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, '#3a3e45'); gr.addColorStop(1, '#101114'); g.fillStyle = gr; g.fillRect(x, 4, 8, h - 8); } })), roughness: .45, metalness: .5, side: THREE.DoubleSide })
  };

  /* garage room */
  const garage = { strips: [], beacons: [], lights: {} };
  (function buildGarage() {
    const G = new THREE.Group(); scene.add(G);
    const shape = new THREE.Shape(); shape.moveTo(-40, -40); shape.lineTo(40, -40); shape.lineTo(40, 8.2); shape.lineTo(-40, 8.2); shape.lineTo(-40, -40);
    const hole = new THREE.Path(); hole.absarc(0, 0, R_TT + 0.04, 0, Math.PI * 2, true); shape.holes.push(hole);
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape, 96), stdMat({ map: TEX.floor, roughnessMap: TEX.floorRough, roughness: 0.85, metalness: 0, envMapIntensity: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; G.add(floor);
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(R_TT + 0.04, R_TT + 0.04, 4.2, 64, 1, true), stdMat({ color: 0x15181d, roughness: .55, metalness: .6, side: THREE.BackSide })); pit.position.y = -2.1; G.add(pit);
    const pitRing = new THREE.Mesh(new THREE.TorusGeometry(R_TT + 0.06, 0.035, 8, 96), stdMat({ color: 0x9aa0a8, metalness: 1, roughness: .25 }));
    pitRing.rotation.x = Math.PI / 2; pitRing.position.y = 0.01; G.add(pitRing);
    const ringTex = texFrom(makeCanvas(1024, 1024, (g, w) => {
      const c = w / 2, r0 = c * (R_TT + 0.12) / (R_TT + 0.5), r1 = c * (R_TT + 0.42) / (R_TT + 0.5), n = 72;
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, sk = 0.05;
        g.fillStyle = i % 2 ? '#141414' : '#e8ad1f';
        g.beginPath(); g.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0); g.lineTo(c + Math.cos(a0 + sk) * r1, c + Math.sin(a0 + sk) * r1);
        g.lineTo(c + Math.cos(a1 + sk) * r1, c + Math.sin(a1 + sk) * r1); g.lineTo(c + Math.cos(a1) * r0, c + Math.sin(a1) * r0); g.closePath(); g.fill();
      }
      wear(g, w, w, 5000);
    }));
    const decal = map => stdMat({ map, transparent: true, roughness: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const ringPlane = new THREE.Mesh(new THREE.PlaneGeometry((R_TT + 0.5) * 2, (R_TT + 0.5) * 2), decal(ringTex));
    ringPlane.rotation.x = -Math.PI / 2; ringPlane.position.y = 0.003; ringPlane.receiveShadow = true; G.add(ringPlane);
    const stencil = texFrom(makeCanvas(1024, 640, (g, w, h) => {
      g.fillStyle = '#e8ad1f'; g.font = `900 ${h * 0.95}px "Big Shoulders Stencil Display", "Big Shoulders Display", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('09', w / 2, h * 0.54); wear(g, w, h, 9000);
    }));
    const num = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.62), decal(stencil));
    num.rotation.x = -Math.PI / 2; num.position.set(0, 0.004, R_TT + 2.0); G.add(num);
    const lineTex = texFrom(makeCanvas(64, 1024, (g, w, h) => { g.fillStyle = '#e3a91d'; g.fillRect(0, 0, w, h); wear(g, w, h, 2400); }));
    [-4.1, 4.1].forEach(x => {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 16), decal(lineTex));
      l.rotation.x = -Math.PI / 2; l.position.set(x, 0.004, 1.5); G.add(l);
    });

    const metal = stdMat({ map: TEX.metal, roughness: .6, metalness: .55, envMapIntensity: .5 });
    const block = stdMat({ map: TEX.block, roughness: .9, metalness: 0, envMapIntensity: .3 });
    const wallBox = (w, h, d, mat, x, y, z, tile) => { const m = new THREE.Mesh(uvMeters(new THREE.BoxGeometry(w, h, d), w, h, tile), mat); m.position.set(x, y, z); m.receiveShadow = true; G.add(m); };
    const RH = 7.0, DW = 4.8, DH = 3.7, BZ = -8;
    wallBox(22.4, RH, 0.4, metal, 0, RH / 2, BZ, 1.6);
    wallBox(0.4, RH, 28, block, -11, RH / 2, 6, 4);
    wallBox(0.4, RH, 28, block, 11, RH / 2, 6, 4);
    wallBox(22.4, RH, 0.4, block, 0, RH / 2, 20, 4);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(22, 28), stdMat({ color: 0x0d0f12, roughness: 1 })); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, RH, 6); G.add(ceil);
    const postMat = stdMat({ map: texFrom(makeCanvas(64, 512, (g, w, h) => { for (let y = -w; y < h + w; y += 40) { g.fillStyle = (y / 40) % 2 ? '#151515' : '#e3a91d'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y - 24); g.lineTo(w, y + 16); g.lineTo(0, y + 40); g.fill(); } wear(g, w, h, 600); })), roughness: .6 });
    [-1, 1].forEach(sx => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, DH, 0.5), postMat); p.position.set(sx * (DW / 2 + 0.04), DH / 2, BZ + 0.05); G.add(p); });
    const beamMat = stdMat({ color: 0x1c2026, roughness: .5, metalness: .7 });
    for (let z = -6; z <= 18; z += 4) { const b = new THREE.Mesh(new THREE.BoxGeometry(22, 0.36, 0.2), beamMat); b.position.set(0, RH - 0.18, z); G.add(b); }
    garage.RH = RH;

    // closed roll-up door (decor only)
    const doorTex = texFrom(makeCanvas(1024, 820, (g, w, h) => {
      g.fillStyle = '#2b3139'; g.fillRect(0, 0, w, h);
      const n = 9; for (let i = 0; i < n; i++) { const y = i * h / n; const gr = g.createLinearGradient(0, y, 0, y + h / n); gr.addColorStop(0, '#3a414b'); gr.addColorStop(.5, '#2a3038'); gr.addColorStop(1, '#1b1f25'); g.fillStyle = gr; g.fillRect(0, y, w, h / n); }
      speckle(g, w, h, 3000, ['#4a525c', '#15181c'], .4, 1.4, .1, .4);
      g.fillStyle = 'rgba(232,173,31,.9)'; g.font = `900 ${h * .62}px "Big Shoulders Stencil Display", "Big Shoulders Display", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('09', w / 2, h * .52);
      g.fillStyle = 'rgba(232,230,220,.75)'; g.font = `700 ${h * .045}px "Barlow", sans-serif`; g.fillText('KEEP CLEAR · DOOR OPERATES AUTOMATICALLY', w / 2, h * .9);
    }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), stdMat({ map: doorTex, roughness: .55, metalness: .5, envMapIntensity: .6 }));
    face.position.set(0, DH / 2, BZ + 0.22); G.add(face);
    for (let i = 1; i < 9; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.03, 0.03), beamMat); rib.position.set(0, i * DH / 9, BZ + 0.23); G.add(rib); }

    // ceiling LED strips (lit)
    const housing = stdMat({ color: 0x0c0d10, roughness: .4, metalness: .6 });
    const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3) });
    [[-4.6, -2.5], [-4.6, 5.5], [0, -2.5], [0, 5.5], [4.6, -2.5], [4.6, 5.5]].forEach(([x, z]) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 7.4), housing); h.position.set(x, RH - 0.4, z); G.add(h);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 7.2), lit); tube.position.set(x, RH - 0.455, z); G.add(tube);
    });

    // neon sign
    const neonTex = texFrom(makeCanvas(1024, 400, (g, w, h) => {
      const glowText = (txt, font, col, y, blur) => { g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = col; g.shadowBlur = blur; g.strokeStyle = col; g.lineWidth = 7; g.lineJoin = 'round'; for (let i = 0; i < 3; i++) g.strokeText(txt, w / 2, y); g.shadowBlur = 0; g.strokeStyle = '#fff4f6'; g.lineWidth = 2.4; g.strokeText(txt, w / 2, y); };
      glowText('BAY NINE', `800 ${h * .44}px "Big Shoulders Display", sans-serif`, '#ff355e', h * .4, 34);
      glowText('SERVICE · STORAGE · LIFT', `700 ${h * .12}px "Barlow", sans-serif`, '#5fd4ff', h * .8, 20);
    }));
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.64), new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    neon.position.set(-6.4, 3.6, BZ + 0.24); G.add(neon);
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.8, 0.04), stdMat({ color: 0x0b0c0f, roughness: .2, metalness: .3 })); board.position.set(-6.4, 3.6, BZ + 0.21); G.add(board);
    const neonLight = new THREE.PointLight(0xff4466, phys(1.1, 7, 2, 1.5), 7, 2); neonLight.position.set(-6.4, 3.4, BZ + 1.2); G.add(neonLight);

    const sign = texFrom(makeCanvas(512, 320, (g, w, h) => {
      g.fillStyle = '#e8ad1f'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.fillRect(14, 14, w - 28, h - 28); g.fillStyle = '#e8ad1f'; g.fillRect(24, 24, w - 48, h - 48);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.font = `900 ${h * .3}px "Big Shoulders Display", sans-serif`; g.fillText('MIND', w / 2, h * .42); g.fillText('THE LIFT', w / 2, h * .74); wear(g, w, h, 1400);
    }));
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.69), stdMat({ map: sign, roughness: .6 })); signM.position.set(4.1, 2.3, BZ + 0.21); G.add(signM);

    // props: tyre stacks, tool chest, workbench
    const rubber = stdMat({ color: 0x0f0f10, roughness: .88 });
    const tg = makeTireGeo(0.33, 0.26, 0.22);
    [[-7.6, -7.1], [-7.0, -6.55], [8.6, -6.9]].forEach(([x, z], k) => {
      for (let i = 0; i < 4 - (k === 2 ? 1 : 0); i++) { const t = new THREE.Mesh(tg, rubber); t.rotation.z = Math.PI / 2; t.rotation.y = rand(0, 6); t.position.set(x + rand(-.03, .03), 0.13 + i * 0.262, z); t.castShadow = true; t.receiveShadow = true; G.add(t); }
    });
    const chestTex = texFrom(makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = '#7d1a17'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) { const y = 10 + i * 40; g.fillStyle = '#5e1210'; g.fillRect(8, y, w - 16, 34); g.fillStyle = '#c9ccd0'; g.fillRect(w / 2 - 40, y + 14, 80, 5); }
    }));
    const red = stdMat({ color: 0x6d1715, roughness: .35, metalness: .3 });
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.15, 0.6), [red, red, red, red, stdMat({ map: chestTex, roughness: .35, metalness: .3 }), red]);
    chest.position.set(-9.3, 0.62, -7.35); chest.castShadow = true; G.add(chest);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 0.8), stdMat({ color: 0x5a3f28, roughness: .7 })); bench.position.set(7.4, 0.95, -7.3); bench.castShadow = true; G.add(bench);
    const legMat = stdMat({ color: 0x22262c, metalness: .6, roughness: .5 });
    [-1.3, 1.3].forEach(dx => { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.7), legMat); leg.position.set(7.4 + dx, 0.47, -7.3); G.add(leg); });
    const peg = texFrom(makeCanvas(512, 256, (g, w, h) => {
      g.fillStyle = '#8a7656'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a3e2c';
      for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
      g.fillStyle = '#1b1d21'; g.strokeStyle = '#1b1d21';
      for (let i = 0; i < 7; i++) { const x = 40 + i * 62, l = 70 + (i % 3) * 25; g.lineWidth = 9; g.beginPath(); g.moveTo(x, 40); g.lineTo(x, 40 + l); g.stroke(); g.beginPath(); g.arc(x, 40, 13, 0, 7); g.fill(); g.fillStyle = '#8a7656'; g.beginPath(); g.arc(x, 34, 6, 0, 7); g.fill(); g.fillStyle = '#1b1d21'; }
      g.fillStyle = '#9b1c1c'; g.fillRect(w - 120, 150, 90, 70);
    }));
    const pegM = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), stdMat({ map: peg, roughness: .9 })); pegM.position.set(7.4, 2.0, -7.78); G.add(pegM);

    // lights
    scene.add(new THREE.HemisphereLight(0x7d8aa0, 0x1a1612, 0.32 * Math.PI));
    const key = new THREE.SpotLight(0xfff3e6, phys(2.4, 22, 1.1, 6), 22, 0.78, 0.75, 1.1);
    key.position.set(0.6, RH - 0.5, 1.2); key.target.position.set(0, 0, 0);
    key.castShadow = true; key.shadow.mapSize.set(isPhone ? 1024 : 2048, isPhone ? 1024 : 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.camera.near = 1; key.shadow.camera.far = 12;
    scene.add(key, key.target);
    const rimL = new THREE.SpotLight(0xa9c4ff, phys(1.1, 24, 1.4, 9.8), 24, 0.6, 0.9, 1.4); rimL.position.set(-8, 3.5, -5); rimL.target.position.set(0, 0.6, 0); scene.add(rimL, rimL.target);
    const rimR = new THREE.SpotLight(0xffd2a8, phys(0.9, 24, 1.4, 9.4), 24, 0.6, 0.9, 1.4); rimR.position.set(8, 3.2, -4); rimR.target.position.set(0, 0.6, 0); scene.add(rimR, rimR.target);
    const front = new THREE.PointLight(0xffffff, phys(0.5, 26, 2, 10.8), 26, 2); front.position.set(0, 4.2, 10); scene.add(front);

    // amber lift beacons
    [[-R_TT - 0.7, R_TT - 0.2], [R_TT + 0.7, -R_TT + 0.2]].forEach(([x, z]) => {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(.11, .13, .12, 16), stdMat({ color: 0x15171a, roughness: .5 })); base.position.set(x, .06, z); G.add(base);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5a3a00 })); dome.position.set(x, .12, z); G.add(dome);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: 0xffa000, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })); sp.scale.set(1.6, 1.6, 1); sp.position.set(x, .2, z); G.add(sp);
      const pl = new THREE.PointLight(0xff9a00, 0, 6, 2); pl.position.set(x, .5, z); G.add(pl);
      garage.beacons.push({ dome, sp, pl });
    });

    // light cone + dust under the key light
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xfff1dc) }, uI: { value: 0.07 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); vY = uv.y; gl_Position = projectionMatrix*viewMatrix*wp; }',
      fragmentShader: 'uniform vec3 uColor; uniform float uI; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float f = pow(abs(dot(vN,vV)),2.2); float h = smoothstep(0.0,0.35,vY)*smoothstep(1.0,0.75,vY); gl_FragColor = vec4(uColor*f*h*uI, 1.0); }'
    });
    garage.cone = new THREE.Mesh(new THREE.ConeGeometry(4.8, 6.6, 48, 1, true), coneMat);
    garage.cone.position.set(0.6, 6.5 - 3.3, 1.2); scene.add(garage.cone);
    const N = isPhone ? 260 : 520; const pos = new Float32Array(N * 3); const spd = new Float32Array(N);
    for (let i = 0; i < N; i++) { const y = Math.random() * 6; const rr = Math.sqrt(Math.random()) * 4.4 * (1 - y / 7.5); const a = Math.random() * 6.283; pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = y + .2; pos[i * 3 + 2] = Math.sin(a) * rr; spd[i] = rand(.03, .12); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    garage.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.035, map: TEX.glow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff2dd }));
    garage.dust.userData.spd = spd; scene.add(garage.dust);
  })();

  function updateDust(dt, t) {
    if (REDUCED) return;
    const d = garage.dust, p = d.geometry.attributes.position.array, s = d.userData.spd;
    for (let i = 0; i < s.length; i++) { p[i * 3 + 1] += Math.sin(t * .3 + i) * dt * s[i] * .5 - dt * .02; p[i * 3] += Math.cos(t * .2 + i * 1.7) * dt * s[i] * .3; if (p[i * 3 + 1] < .1) p[i * 3 + 1] = 6; }
    d.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------- cars ---------- */
  // parked look: the prototype's "engine running" lamp level
  function lampMat(kind) {
    if (kind === 'tail') return new THREE.MeshStandardMaterial({ color: 0x2a0303, emissive: 0xff1608, emissiveIntensity: 1.7, roughness: .2, metalness: .3, side: THREE.DoubleSide });
    if (kind === 'amber') return new THREE.MeshStandardMaterial({ color: 0x3a2000, emissive: 0xffa000, emissiveIntensity: 0.4, roughness: .2, metalness: .3, side: THREE.DoubleSide });
    return new THREE.MeshStandardMaterial({ color: 0xcfd6de, emissive: 0xe8f0ff, emissiveIntensity: 1.3, roughness: .12, metalness: .85, envMapIntensity: 1.6, side: THREE.DoubleSide });
  }

  function makeWheel(d, mats, side) {
    const { r, tw } = d; const rimR = r * (d.rimRatio || 0.7);
    const w = new THREE.Group(); const spin = new THREE.Group(); w.add(spin);
    const tire = new THREE.Mesh(makeTireGeo(r, tw, rimR), M.rubber); spin.add(tire);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.96, tw * 0.92, 40, 1, true), mats.rimInner); barrel.rotation.z = Math.PI / 2; spin.add(barrel);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.006, 0.014, 8, 48), mats.rim); lip.rotation.y = Math.PI / 2; lip.position.x = tw * 0.44; spin.add(lip);
    const face = new THREE.Group(); face.position.x = tw * 0.36; spin.add(face);
    const hubR = rimR * 0.2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR * 1.1, 0.05, 24), mats.rim); hub.rotation.z = Math.PI / 2; face.add(hub);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.42, hubR * 0.42, 0.07, 6), M.chrome); nut.rotation.z = Math.PI / 2; nut.position.x = 0.01; face.add(nut);
    if (d.style === 'steel') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.97, rimR * 0.97, 0.02, 40), mats.rim); disc.rotation.z = Math.PI / 2; disc.position.x = -0.01; face.add(disc);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const h = new THREE.Mesh(new THREE.CircleGeometry(0.038, 16), M.well); h.rotation.y = Math.PI / 2; h.position.set(0.003, Math.cos(a) * rimR * 0.58, Math.sin(a) * rimR * 0.58); face.add(h); }
      const bead = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.95, 0.022, 8, 48), mats.rim); bead.rotation.y = Math.PI / 2; bead.position.x = 0.03; face.add(bead);
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), M.chrome); b.rotation.z = Math.PI / 2; b.position.set(0.05, Math.cos(a) * rimR * 0.95, Math.sin(a) * rimR * 0.95); face.add(b); }
    } else { // aero
      const cap = new THREE.Mesh(new THREE.SphereGeometry(rimR * 1.6, 40, 12, 0, Math.PI * 2, 0, 0.66), mats.rim);
      cap.rotation.z = -Math.PI / 2; cap.position.x = -rimR * 1.6 * Math.cos(0.66) - 0.01; face.add(cap);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const sl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.14, 0.03), M.well); const g = new THREE.Group(); g.rotation.x = a; sl.position.set(0.028, rimR * 0.62, 0); sl.rotation.x = 0.5; g.add(sl); face.add(g); }
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.028, 36), M.disc); disc.rotation.z = Math.PI / 2; disc.position.x = -0.02; spin.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.07, rimR * 0.62, 0.12), mats.caliper); const cg = new THREE.Group(); cg.rotation.x = -0.6; cal.position.set(0.02, rimR * 0.62, 0); cg.add(cal); w.add(cg);
    w.traverse(o => { if (o.isMesh) o.castShadow = true; });
    if (side < 0) w.rotation.y = Math.PI;
    return w;
  }

  function buildCar(def, paintHex, plateText) {
    const D = def.geo;
    const car = { root: new THREE.Group(), rig: new THREE.Group(), glows: [], D, paintHex };
    // camera pull-back for long/tall bodies; 1 for the two generic bodies
    car.k = Math.max(1, (D.sMax - D.sMin) / 5.1, Math.max(...D.gh.roof.map(p => p[1])) / 2.05);
    car.root.add(car.rig);
    const f = def.finish;
    const paint = new THREE.MeshPhysicalMaterial({ color: paintHex, envMapIntensity: 1.25, metalness: f.metalness, roughness: f.roughness, clearcoat: f.clearcoat, clearcoatRoughness: f.cr });
    car.mats = {
      rim: new THREE.MeshStandardMaterial({ color: def.rim.hex, metalness: def.rim.m, roughness: def.rim.r, envMapIntensity: 1.4 }),
      rimInner: new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: .9, roughness: .4, side: THREE.DoubleSide }),
      caliper: new THREE.MeshStandardMaterial({ color: def.caliper, metalness: .2, roughness: .35 })
    };

    const top = curve(D.top), wid = curve(D.width);
    const arches = [[D.axF, D.flareF, D.skirtF], [D.axR, D.flareR, D.skirtR]];
    const archR = D.r + (D.archGap || 0.07);
    const bodySec = s => {
      let b = D.sill, w = wid(s);
      arches.forEach(([ax, fl, skirt]) => {
        const dx = s - ax;
        if (Math.abs(dx) < archR) { const at = D.r + Math.sqrt(archR * archR - dx * dx); b = Math.max(b, skirt ? Math.min(at, D.r * skirt) : at); }
        const t = dx / (archR + 0.32);
        if (Math.abs(t) < 1) w += fl * (D.boxFlare ? clamp((1 - Math.abs(t)) * 3, 0, 1) : Math.pow(Math.cos(t * Math.PI / 2), 2));
      });
      return { w, b, t: Math.max(top(s), b + 0.08), n: D.n, tumble: D.tumble, tuck: D.tuck };
    };
    const bodyMesh = new THREE.Mesh(loft(D.sMin, D.sMax, isPhone ? 150 : 200, 48, bodySec, { rf: D.rf, rr: D.rr, pf: D.pf, pr: D.pr }), paint);
    bodyMesh.castShadow = true; bodyMesh.receiveShadow = true; car.rig.add(bodyMesh);
    bodyMesh.updateMatrixWorld(true);

    const G = D.gh, roof = curve(G.roof), gw = curve(G.width);
    const ghSec = s => { const base = top(s) - 0.07, rf = Math.max(roof(s), base + 0.004); return { w: gw(s), b: base - (rf - base) * 0.9, t: rf, n: G.n, tumble: G.tumble, tuck: 0.35 }; };
    const rp = G.roofPaint;
    const gh = new THREE.Mesh(loft(G.roof[0][0], G.roof[G.roof.length - 1][0], 90, 40, ghSec, { rf: 0.08, rr: 0.08, pf: 0.5, pr: 0.5 }, rp ? (s, j) => { const th = j / 40 * Math.PI * 2; return rp.some(([s0, s1, ang]) => s > s0 && s < s1 && Math.abs(th - Math.PI) < ang); } : null), [M.glass, paint]);
    gh.castShadow = true; car.rig.add(gh);
    [-1, 1].forEach(sx => {
      const ms = G.mirrorS, my = top(ms) + 0.1, mx = sx * (gw(ms) + 0.14);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), paint); cap.scale.set(1.25, 0.75, 1.35); cap.position.set(mx, my, ms); cap.castShadow = true; car.rig.add(cap);
      const glassM = new THREE.Mesh(new THREE.CircleGeometry(0.065, 16), M.chrome); glassM.scale.set(1.2, 0.7, 1); glassM.position.set(mx, my, ms - 0.1); glassM.rotation.y = Math.PI; car.rig.add(glassM);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.05), M.trim); stalk.position.set(sx * (gw(ms) + 0.06), my - 0.03, ms); car.rig.add(stalk);
    });

    const track = D.track, trackR = D.trackR || track;
    [[D.axF, track], [D.axR, trackR]].forEach(([ax, tr]) => [-1, 1].forEach(sx => {
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(archR - 0.01, archR - 0.01, D.tw + 0.16, 24, 1, true, 0, Math.PI), M.well);
      liner.rotation.z = Math.PI / 2; liner.position.set(sx * (tr - 0.02), D.r, ax); car.rig.add(liner);
    }));
    const tray = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.4, (track - D.tw / 2 - 0.06) * 2), D.sill + 0.22 - 0.1, (D.sMax - D.sMin) - 0.7), M.well);
    tray.position.set(0, 0.1 + (D.sill + 0.12) / 2, (D.sMax + D.sMin) / 2); car.rig.add(tray);
    [[D.axF, 1], [D.axR, 0]].forEach(([ax, isFront]) => [-1, 1].forEach(sx => {
      const w = makeWheel({ r: D.r, tw: D.tw, style: def.rimStyle, rimRatio: D.rimRatio }, car.mats, sx);
      w.position.set(sx * (isFront ? track : trackR), D.r, ax); car.root.add(w);
    }));
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(D.track * 2 + 0.7, (D.sMax - D.sMin) + 0.7), new THREE.MeshBasicMaterial({ map: TEX.contact, transparent: true, depthWrite: false, opacity: 0.9 }));
    cs.rotation.x = -Math.PI / 2; cs.position.set(0, 0.006, (D.sMax + D.sMin) / 2); cs.renderOrder = 1; car.root.add(cs); car.contact = cs;

    const V = THREE.Vector3;
    D.doors.forEach(sd => [-1, 1].forEach(sx => {
      const ys = []; for (let y = D.sill + 0.06; y < top(sd) - 0.03; y += 0.025) ys.push(new V(sx * 3, y, sd));
      const m = ribbon(bodyMesh, ys, new V(-sx, 0, 0), new V(0, 0, 1), 0.0035, M.trim, 0.003); if (m) car.rig.add(m);
    }));
    [-1, 1].forEach(sx => {
      const sd = D.doors[1] + 0.2, y = top(sd) - 0.13; const os = []; for (let s = sd; s <= sd + 0.2; s += 0.02) os.push(new V(sx * 3, y, s));
      const m = ribbon(bodyMesh, os, new V(-sx, 0, 0), new V(0, 1, 0), 0.012, M.trim, 0.004); if (m) car.rig.add(m);
    });

    const glow = (kind, hits) => {
      if (kind === 'amber') return;
      const step = Math.max(1, Math.floor(hits.length / 3));
      for (let i = 0; i < hits.length; i += step) car.glows.push({ kind, p: hits[i].p.clone(), n: hits[i].n.clone() });
    };
    const api = {
      car, lampMat, glow, D, top,
      add(o) { car.rig.add(o); return o; },
      mirrorX(fn) { fn(1); fn(-1); },
      strip(end, y, x0, x1, halfH, kind) {
        const os = []; for (let i = 0; i <= 26; i++) os.push(new V(lerp(x0, x1, i / 26), y, end * 6));
        const m = ribbon(bodyMesh, os, new V(0, 0, -end), new V(0, 1, 0), halfH, lampMat(kind), 0.006);
        if (m) { car.rig.add(m); glow(kind, m.userData.hits); }
      },
      round(end, x, y, r, kind, tall = 1) {
        const h = hit(bodyMesh, new V(x, y, end * 6), new V(0, 0, -end)); if (!h) return;
        const g = new THREE.Group(); g.position.copy(h.p).addScaledVector(h.n, 0.012); orientTo(g, h.n); g.scale.y = tall;
        g.add(new THREE.Mesh(new THREE.CircleGeometry(r, 28), lampMat(kind)));
        g.add(new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.16, 8, 28), kind === 'tail' ? M.trim : M.chrome));
        const back = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, 0.05, 28, 1, true), M.trim); back.rotation.x = Math.PI / 2; back.position.z = -0.025; g.add(back);
        car.rig.add(g); glow(kind, [{ p: g.position.clone(), n: h.n }]);
      },
      grille(end, x0, x1, y0, y1, mat, nu = 10, nv = 6) {
        const m = patch(bodyMesh, nu, nv, (u, v) => new V(lerp(x0, x1, u), lerp(y0, y1, v), end * 6), new V(0, 0, -end), mat, 0.004);
        if (m) car.rig.add(m);
      },
      sideStripe(sx, s0, s1, y, halfH, mat) {
        const os = []; for (let i = 0; i <= 40; i++) os.push(new V(sx * 3, y, lerp(s0, s1, i / 40)));
        const m = ribbon(bodyMesh, os, new V(-sx, 0, 0), new V(0, 1, 0), halfH, mat, 0.004); if (m) car.rig.add(m);
      },
      plate(y, w = 0.52, h = 0.12) {
        const hh = hit(bodyMesh, new V(0, y, -6), new V(0, 0, 1)); if (!hh) return;
        const tex = texFrom(makeCanvas(512, 120, (g, W, H) => { g.fillStyle = '#ecebe6'; g.fillRect(0, 0, W, H); g.strokeStyle = '#1b1c1f'; g.lineWidth = 6; g.strokeRect(5, 5, W - 10, H - 10); g.fillStyle = '#16171a'; g.font = `700 ${H * .66}px "Chakra Petch", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(plateText, W / 2, H * .54, W - 30); }));
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: .5, metalness: .2 }));
        m.position.copy(hh.p).addScaledVector(hh.n, 0.008); orientTo(m, hh.n); car.rig.add(m);
      },
      box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; car.rig.add(m); },
      cyl(r0, r1, h, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 20), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; car.rig.add(m); }
    };
    def.build(api, M);

    car.glows.forEach(g => {
      const head = g.kind !== 'tail';
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: head ? 0xdfeaff : 0xff2a1a, blending: THREE.AdditiveBlending, depthWrite: false, opacity: head ? 0.22 : 0.45 }));
      sp.position.copy(g.p).addScaledVector(g.n, 0.05); sp.scale.setScalar(head ? 0.7 : 0.45); car.rig.add(sp);
    });
    return car;
  }

  /* ---------- turntable with planar reflection ---------- */
  const tt = { group: new THREE.Group(), plate: new THREE.Group() };
  scene.add(tt.group); tt.group.add(tt.plate);
  const mirrorRT = new THREE.WebGLRenderTarget(512, 512, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  mirrorRT.texture.generateMipmaps = false;
  const mirrorCam = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();
  const topMat = new THREE.ShaderMaterial({
    uniforms: { tMirror: { value: mirrorRT.texture }, textureMatrix: { value: textureMatrix }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) }, uBase: { value: new THREE.Color(0x07080a) }, uAccent: { value: new THREE.Color(0xe2501b) }, uGlow: { value: 1 }, uRad: { value: R_TT }, uRot: { value: 0 } },
    vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vLocal; void main(){ vUv = textureMatrix*vec4(position,1.0); vLocal = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'uniform sampler2D tMirror; uniform vec2 uTexel; uniform vec3 uBase; uniform vec3 uAccent; uniform float uGlow; uniform float uRad; uniform float uRot;',
      'varying vec4 vUv; varying vec2 vLocal;',
      'void main(){',
      '  vec2 uv = vUv.xy / vUv.w;',
      '  vec3 r = texture2D(tMirror, uv).rgb * 0.36;',
      '  r += texture2D(tMirror, uv + vec2( uTexel.x*1.6, 0.0)).rgb * 0.16;',
      '  r += texture2D(tMirror, uv + vec2(-uTexel.x*1.6, 0.0)).rgb * 0.16;',
      '  r += texture2D(tMirror, uv + vec2(0.0,  uTexel.y*1.6)).rgb * 0.16;',
      '  r += texture2D(tMirror, uv + vec2(0.0, -uTexel.y*1.6)).rgb * 0.16;',
      '  float rad = length(vLocal) / uRad;',
      '  float ang = atan(vLocal.y, vLocal.x) + uRot;',
      '  float groove = smoothstep(0.86, 1.0, 0.5 + 0.5*sin(rad*uRad*70.0)) * 0.018;',
      '  float seg = smoothstep(0.985, 1.0, abs(cos(ang*12.0))) * step(0.3, rad) * 0.03;',
      '  float refl = 0.62 * (1.0 - smoothstep(0.8, 1.0, rad));',
      '  vec3 col = uBase + groove + seg + min(r, vec3(1.6)) * refl;',
      '  col += uAccent * uGlow * pow(smoothstep(0.9, 1.0, rad), 2.0) * 0.5;',
      '  col += uAccent * uGlow * smoothstep(0.08, 0.0, abs(rad - 0.32)) * 0.06;',
      '  gl_FragColor = vec4(col, 1.0);',
      '  #include <colorspace_fragment>',
      '}'].join('\n')
  });
  const ttTop = new THREE.Mesh(new THREE.CircleGeometry(R_TT, 128), topMat);
  ttTop.rotation.x = -Math.PI / 2; ttTop.position.y = TT_TOP; tt.group.add(ttTop);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R_TT, R_TT, 0.6, 96, 1, true), stdMat({ color: 0x2a2e35, metalness: .9, roughness: .3 }));
  skirt.position.y = TT_TOP - 0.3; tt.group.add(skirt);
  const ttRing = new THREE.Mesh(new THREE.TorusGeometry(R_TT - 0.025, 0.016, 8, 160), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ttRing.rotation.x = Math.PI / 2; ttRing.position.y = TT_TOP + 0.004; tt.group.add(ttRing);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R_TT, 0.03, 10, 160), stdMat({ color: 0x8e949c, metalness: 1, roughness: .2 }));
  lip.rotation.x = Math.PI / 2; lip.position.y = TT_TOP - 0.01; tt.group.add(lip);
  const liftLight = new THREE.PointLight(0xffa000, 0, 7, 2); liftLight.position.y = 1.2; tt.group.add(liftLight);
  let ringTarget = null;

  function setAccentColor(hex) {
    const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
    const l = clamp(hsl.l, 0.42, 0.72), s = hsl.s < 0.12 ? hsl.s : Math.max(hsl.s, 0.55);
    const ui = new THREE.Color().setHSL(hsl.h, s, l);
    root.style.setProperty('--accent', '#' + ui.getHexString());
    ringTarget = ui.clone().multiplyScalar(2.4);
    topMat.uniforms.uAccent.value.copy(ui);
  }

  const _n = new THREE.Vector3(0, 1, 0), _wp = new THREE.Vector3(), _cp = new THREE.Vector3(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _tgt = new THREE.Vector3(), _view = new THREE.Vector3(), _pl = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
  function renderMirror() {
    ttTop.updateMatrixWorld();
    _wp.setFromMatrixPosition(ttTop.matrixWorld); _cp.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(_wp, _cp); if (_view.dot(_n) > 0) return;
    _view.reflect(_n).negate().add(_wp);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cp);
    _tgt.subVectors(_wp, _look).reflect(_n).negate().add(_wp);
    mirrorCam.position.copy(_view);
    mirrorCam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    mirrorCam.lookAt(_tgt);
    mirrorCam.far = camera.far; mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse).multiply(ttTop.matrixWorld);
    _pl.setFromNormalAndCoplanarPoint(_n, _wp); _pl.applyMatrix4(mirrorCam.matrixWorldInverse);
    _clip.set(_pl.normal.x, _pl.normal.y, _pl.normal.z, _pl.constant);
    const e = mirrorCam.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + e[8]) / e[0]; _q.y = (Math.sign(_clip.y) + e[9]) / e[5]; _q.z = -1; _q.w = (1 + e[10]) / e[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1 - 0.003; e[14] = _clip.w;
    mirrorCam.projectionMatrixInverse.copy(mirrorCam.projectionMatrix).invert();
    ttTop.visible = false; const cs = current && current.contact; if (cs) cs.visible = false;
    garage.dust.visible = false; garage.cone.visible = false;
    renderer.setRenderTarget(mirrorRT); renderer.clear(); renderer.render(scene, mirrorCam); renderer.setRenderTarget(null);
    ttTop.visible = true; if (cs) cs.visible = true; garage.dust.visible = true; garage.cone.visible = true;
  }

  /* ---------- orbit camera + input ---------- */
  const orbit = { th: 1.12, ph: 1.32, rad: 11, tgt: new THREE.Vector3(0, 0.62, 0), g: { th: 0.62, ph: 1.2, rad: 8.6, tgt: new THREE.Vector3(0, 0.62, 0) }, fitK: 1 };
  function goView(v) {
    const V = VIEWS[v]; if (!V) return;
    orbit.g.th = orbit.th + wrapPi(V.th - orbit.th); orbit.g.ph = V.ph; orbit.g.rad = V.rad; orbit.g.tgt.set(0, V.y, 0);
  }
  const _cam = new THREE.Vector3();
  function updateOrbit(dt) {
    const k = Math.min(1, dt * 5.5);
    orbit.th += (orbit.g.th - orbit.th) * k; orbit.ph += (orbit.g.ph - orbit.ph) * k; orbit.rad += (orbit.g.rad - orbit.rad) * k;
    orbit.tgt.lerp(orbit.g.tgt, k);
    const r = orbit.rad * orbit.fitK * (current ? current.k : 1);
    _cam.set(Math.sin(orbit.ph) * Math.sin(orbit.th) * r, Math.cos(orbit.ph) * r, Math.sin(orbit.ph) * Math.cos(orbit.th) * r).add(orbit.tgt);
    _cam.x = clamp(_cam.x, -10.3, 10.3); _cam.z = clamp(_cam.z, -7.3, 19.3); _cam.y = clamp(_cam.y, 0.25, garage.RH - 0.4);
    camera.position.copy(_cam);
    camera.lookAt(orbit.tgt);
  }

  const ptrs = new Map(); let pinch0 = 0, rad0 = 0;
  const onDown = e => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); rad0 = orbit.g.rad; }
    canvas.classList.add('dragging');
  };
  const onMove = e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) { orbit.g.th -= dx * 0.0058; orbit.g.ph = clamp(orbit.g.ph - dy * 0.0046, PH_MIN, PH_MAX); if (onUserOrbit) onUserOrbit(); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) orbit.g.rad = clamp(rad0 * pinch0 / d, R_MIN, R_MAX); }
  };
  const onUp = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; if (!ptrs.size) canvas.classList.remove('dragging'); };
  const onWheel = e => { e.preventDefault(); orbit.g.rad = clamp(orbit.g.rad * (1 + clamp(e.deltaY, -120, 120) * 0.0011), R_MIN, R_MAX); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight; isPhone = w <= 760;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect; camera.fov = aspect < 0.8 ? 36 : 30;
    const shift = isPhone ? Math.min(150, h * 0.17) : Math.min(60, h * 0.05);
    camera.setViewOffset(w, h, 0, shift, w, h); camera.updateProjectionMatrix();
    orbit.fitK = aspect < 1 ? clamp(0.9 / aspect, 1, 2.0) : aspect < 1.4 ? 1.12 : 1;
    const pr = renderer.getPixelRatio(), sc = isPhone ? 0.4 : 0.5;
    const rw = Math.max(256, Math.round(w * pr * sc)), rh = Math.max(256, Math.round(h * pr * sc));
    mirrorRT.setSize(rw, rh); topMat.uniforms.uTexel.value.set(1 / rw, 1 / rh);
  }
  window.addEventListener('resize', resize);
  resize();

  /* Thumbnail: render to the visible canvas at 1x and copy it out in the same task.
     Render targets skip tone mapping/sRGB output in three r15x+, so this keeps colours right. */
  function makeThumb(car) {
    const W = 400, H = 188;
    const s = new THREE.Scene(); s.environment = envTex;
    const l = new THREE.DirectionalLight(0xffffff, 1.3 * Math.PI); l.position.set(3, 6, 4); s.add(l, new THREE.HemisphereLight(0xc8d4ff, 0x1a1a1a, 0.7 * Math.PI));
    const cam = new THREE.PerspectiveCamera(22, W / H, 0.1, 60);
    const D = car.D, cz = (D.sMax + D.sMin) / 2, k = car.k;
    cam.position.set(6.4 * k, 1.9 * k, 4.1 * k + cz); cam.lookAt(0, 0.62 * k, cz - 0.05);
    s.add(car.root); car.root.position.set(0, 0, 0);
    const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(s, cam);
    const url = canvas.toDataURL('image/png');
    renderer.setClearColor(0x000000, 1); renderer.setPixelRatio(pr); resize();
    s.remove(car.root); l.dispose();
    return url;
  }

  /* ---------- state + selection ---------- */
  const cars = [];
  let current = null, spin = !REDUCED, busy = false, beaconsOn = false;
  const drop = -2.9;

  function mount(car) {
    if (current) tt.plate.remove(current.root);
    current = car;
    current.root.position.set(0, TT_TOP, 0);
    tt.plate.add(current.root); tt.plate.rotation.y = -0.5;
    setAccentColor(current.paintHex);
  }
  // Lowers the lift, swaps in `car` (a fleet car or a catalog preview), raises it.
  async function swap(car) {
    if (disposed || busy || !car || car === current) return;
    busy = true;
    beaconsOn = true;
    if (REDUCED) mount(car);
    else {
      await tween(1.4, k => tt.group.position.y = drop * k, EASE.in);
      mount(car);
      await tween(1.7, k => tt.group.position.y = drop * (1 - k), EASE.outBack);
    }
    tt.group.position.y = 0; beaconsOn = false; busy = false;
  }
  const select = i => swap(cars[i]);
  function view(v) {
    spin = false;
    const a0 = tt.plate.rotation.y, a1 = a0 + wrapPi(-a0); tween(1.1, k => tt.plate.rotation.y = lerp(a0, a1, k));
    goView(v);
  }

  /* ---------- loop ---------- */
  let lastT = performance.now();
  function frame(now) {
    rafId = requestAnimationFrame(frame);    const dt =Math.min(0.05, (now - lastT) / 1000); lastT = now; const t = now / 1000;
    updateTweens(dt);
    if (spin && !busy) tt.plate.rotation.y += dt * 0.13;
    topMat.uniforms.uRot.value = tt.plate.rotation.y;
    if (ringTarget) ttRing.material.color.lerp(ringTarget, Math.min(1, dt * 3));
    liftLight.intensity += ((beaconsOn ? phys(1.6, 7, 2, 1.2) : 0) - liftLight.intensity) * Math.min(1, dt * 6);
    garage.beacons.forEach((b, i) => { const pulse = beaconsOn ? (0.5 + 0.5 * Math.sin(t * 9 + i * Math.PI)) : 0; b.sp.material.opacity = pulse; b.pl.intensity = pulse * phys(1.4, 6, 2, 1); b.dome.material.color.setHex(beaconsOn && pulse > 0.5 ? 0xffb020 : 0x4a3000); });
    topMat.uniforms.uGlow.value = beaconsOn ? 0.6 + 0.4 * Math.sin(t * 9) : 1;
    updateOrbit(dt);
    updateDust(dt, t);
    renderMirror();
    renderer.render(scene, camera);
  }

  async function boot() {
    try {
      if (document.fonts && document.fonts.load) await Promise.race([Promise.all(['900 40px "Big Shoulders Display"', '900 40px "Big Shoulders Stencil Display"', '700 20px "Chakra Petch"', '700 20px "Barlow"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]);
    } catch { /* fonts are cosmetic */ }
    const thumbs = [];
    for (const v of vehicles) {
      if (disposed) return thumbs;
      thumbs.push(park(v));
      progress();
      await new Promise(r => setTimeout(r, 0)); // keep the page responsive between cars
    }
    if (disposed) return thumbs;
    if (cars.length) mount(cars[clamp(startIndex, 0, cars.length - 1)]); // an empty garage still renders
    rafId = requestAnimationFrame(frame);
    return thumbs;
  }
  const perBody = { lumen: 0, basalt: 0 };
  function park(v) {
    const def = defFor(v.model), paints = BODIES[def.fam].paints;
    // A car registered from a catalog preview keeps the paint it was shown in.
    const paint = previewCars.get(v.model)?.paintHex ?? paints[perBody[def.fam]++ % paints.length];
    const car = buildCar(def, paint, v.id);
    cars.push(car);
    return makeThumb(car);
  }

  /* Catalog previews for registering a vehicle: built after the fleet, one car per model. */
  const previewCars = new Map();
  async function buildCatalog() {
    await fleetReady;
    const per = { lumen: 0, basalt: 0 }, thumbs = [];
    for (const model of catalog) {
      if (disposed) break;
      const def = defFor(model), paints = BODIES[def.fam].paints;
      const car = buildCar(def, paints[per[def.fam]++ % paints.length], 'NEW');
      previewCars.set(model, car);
      thumbs.push(makeThumb(car));
      progress();
      await new Promise(r => setTimeout(r, 0));
    }
    return thumbs;
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    const seen = new Set();
    const free = o => { if (o && !seen.has(o)) { seen.add(o); o.dispose(); } };
    const freeTree = node => node.traverse(o => {
      free(o.geometry);
      [].concat(o.material || []).forEach(m => { free(m.map); free(m.roughnessMap); free(m); });
      if (o.isLight) free(o);
    });
    freeTree(scene); cars.forEach(c => freeTree(c.root)); previewCars.forEach(c => freeTree(c.root));
    Object.values(TEX).forEach(free); free(envTex); free(mirrorRT);
    renderer.dispose(); renderer.forceContextLoss();
  }

  const fleetReady = boot();
  return {
    ready: fleetReady,
    catalogReady: buildCatalog(),
    /** Shows the catalog preview for `model` on the lift. Call after `catalogReady`. */
    preview: model => swap(previewCars.get(model)),
    /** Builds a car for a newly registered vehicle in the next bay; returns its thumbnail. Call after `ready`. */
    add: v => (disposed ? '' : park(v)),
    select,
    view,
    setSpin(on) { spin = on; },
    dispose
  };
}
