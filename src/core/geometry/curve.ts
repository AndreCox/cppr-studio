import type { ShapePreset, ShapeSample, ShapeSpec } from '../types';

export interface CurveSample extends ShapeSample {
  kappa: number;
}

export interface DesiredCurve {
  length: number;
  samples: CurveSample[];
  /** Peak |curvature|, 1/mm */
  maxKappa: number;
  /** Total turning angle of the tip tangent, rad */
  tipAngle: number;
  poseAt(s: number): CurveSample;
  kappaAt(s: number): number;
  /** Re-sample the curve at n evenly spaced arc-length points */
  resample(n: number): ShapeSample[];
}

interface ProfileNode {
  t: number;
  v: number;
}

/** Normalised curvature profiles (κ / κ_max) for the shape presets. */
export const PRESET_PROFILES: Record<ShapePreset, { nodes: ProfileNode[]; label: string; description: string }> = {
  constant: {
    label: 'Constant curvature',
    description: 'A circular arc — the classic constant-curvature CPPR (Design 3).',
    nodes: [{ t: 0, v: 1 }, { t: 1, v: 1 }],
  },
  sCurve: {
    label: 'S-curve (double bend)',
    description: 'Two opposed bends with an inflection near mid-length (paper Fig. 8 prototype).',
    nodes: [
      { t: 0, v: 1 }, { t: 0.44, v: 1 }, { t: 0.5, v: 0 },
      { t: 0.56, v: -1 }, { t: 1, v: -1 },
    ],
  },
  tipFirst: {
    label: 'Tip-first bend',
    description: 'Curvature grows toward the tip — high angulation in tight spaces (Design 2).',
    nodes: [
      { t: 0, v: 0.05 }, { t: 0.25, v: 0.08 }, { t: 0.5, v: 0.2 },
      { t: 0.75, v: 0.52 }, { t: 1, v: 1 },
    ],
  },
  baseFirst: {
    label: 'Base-first bend',
    description: 'Curvature is highest at the base — a wide-reaching, near-constant tip angle (Design 4).',
    nodes: [
      { t: 0, v: 1 }, { t: 0.25, v: 0.52 }, { t: 0.5, v: 0.2 },
      { t: 0.75, v: 0.08 }, { t: 1, v: 0.05 },
    ],
  },
  retroflex: {
    label: 'Retroflex (distal bend)',
    description: 'A tight bend near the tip, useful for retroflexion and looking back (Design 5).',
    nodes: [
      { t: 0, v: 0.02 }, { t: 0.5, v: 0.04 }, { t: 0.7, v: 0.3 },
      { t: 0.86, v: 0.82 }, { t: 1, v: 1 },
    ],
  },
  midBend: {
    label: 'Mid-length bend',
    description: 'Bending concentrated at mid-length, straight base and tip.',
    nodes: [
      { t: 0, v: 0.02 }, { t: 0.2, v: 0.12 }, { t: 0.5, v: 1 },
      { t: 0.8, v: 0.12 }, { t: 1, v: 0.02 },
    ],
  },
  straight: {
    label: 'Straight',
    description: 'No bending — a straight tube (useful as a transmission or baseline).',
    nodes: [{ t: 0, v: 0 }, { t: 1, v: 0 }],
  },
};

function profileValue(nodes: ProfileNode[], t: number): number {
  const tt = Math.max(0, Math.min(1, t));
  if (tt <= nodes[0].t) return nodes[0].v;
  for (let i = 1; i < nodes.length; i++) {
    if (tt <= nodes[i].t) {
      const a = nodes[i - 1];
      const b = nodes[i];
      const w = (tt - a.t) / Math.max(1e-9, b.t - a.t);
      return a.v + (b.v - a.v) * w;
    }
  }
  return nodes[nodes.length - 1].v;
}

/** Centripetal Catmull–Rom through points, returning a dense polyline. */
function catmullRom(points: { x: number; z: number }[], perSpan = 48): { x: number; z: number }[] {
  if (points.length < 2) return points.slice();
  const pts = [points[0], ...points, points[points.length - 1]];
  const out: { x: number; z: number }[] = [];
  const alpha = 0.5;
  const tj = (a: { x: number; z: number }, b: { x: number; z: number }, t: number) =>
    t + Math.pow(Math.hypot(b.x - a.x, b.z - a.z) + 1e-9, alpha);
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    const t0 = 0;
    const t1 = tj(p0, p1, t0);
    const t2 = tj(p1, p2, t1);
    const t3 = tj(p2, p3, t2);
    for (let j = 0; j < perSpan; j++) {
      const t = t1 + ((t2 - t1) * j) / perSpan;
      const lerp = (a: { x: number; z: number }, b: { x: number; z: number }, ta: number, tb: number) => {
        const w = (t - ta) / Math.max(1e-12, tb - ta);
        return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
      };
      const A1 = lerp(p0, p1, t0, t1);
      const A2 = lerp(p1, p2, t1, t2);
      const A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2);
      const B2 = lerp(A2, A3, t1, t3);
      const C = lerp(B1, B2, t1, t2);
      out.push(C);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function cumulative(points: { x: number; z: number }[]): { s: number[]; total: number } {
  const s = [0];
  for (let i = 1; i < points.length; i++) {
    s.push(s[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  return { s, total: s[s.length - 1] };
}

/** Sample the curve at a given arc length. */
function sampleAt(samples: CurveSample[], s: number): CurveSample {
  const n = samples.length;
  const total = samples[n - 1].s;
  const target = Math.max(0, Math.min(total, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s > target) hi = mid;
    else lo = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const w = (target - a.s) / Math.max(1e-12, b.s - a.s);
  return {
    s: target,
    x: a.x + (b.x - a.x) * w,
    z: a.z + (b.z - a.z) * w,
    psi: a.psi + (b.psi - a.psi) * w,
    kappa: a.kappa + (b.kappa - a.kappa) * w,
  };
}

/** Integrate a normalised curvature profile into a plan ar curve of length L. */
function integrateProfile(spec: ShapeSpec, L: number): { samples: CurveSample[]; length: number } {
  const prof = PRESET_PROFILES[spec.preset]?.nodes ?? PRESET_PROFILES.constant.nodes;
  const N = 800;
  const samples: CurveSample[] = [];
  let x = 0;
  let z = 0;
  let psi = 0;
  const ds = L / N;
  const kappa = (s: number) => spec.kappaMax * profileValue(prof, s / L);
  samples.push({ s: 0, x, z, psi, kappa: kappa(0) });
  for (let i = 0; i < N; i++) {
    const s0 = i * ds;
    // classical RK4 on (x, z, psi)
    const f = (state: { x: number; z: number; psi: number }, s: number) => ({
      x: Math.sin(state.psi),
      z: Math.cos(state.psi),
      psi: kappa(s),
    });
    const st0 = { x, z, psi };
    const k1 = f(st0, s0);
    const st1 = { x: x + (ds / 2) * k1.x, z: z + (ds / 2) * k1.z, psi: psi + (ds / 2) * k1.psi };
    const k2 = f(st1, s0 + ds / 2);
    const st2 = { x: x + (ds / 2) * k2.x, z: z + (ds / 2) * k2.z, psi: psi + (ds / 2) * k2.psi };
    const k3 = f(st2, s0 + ds / 2);
    const st3 = { x: x + ds * k3.x, z: z + ds * k3.z, psi: psi + ds * k3.psi };
    const k4 = f(st3, s0 + ds);
    x += (ds / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x);
    z += (ds / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z);
    psi += (ds / 6) * (k1.psi + 2 * k2.psi + 2 * k3.psi + k4.psi);
    const s = (i + 1) * ds;
    samples.push({ s, x, z, psi, kappa: kappa(s) });
  }
  return { samples, length: L };
}

export interface WaypointFrame {
  /** control points after base-fixing, rotation to +Z and scaling to length L */
  points: { x: number; z: number }[];
  /** raw control points in mm (before base-fixing) */
  raw: { x: number; z: number }[];
  /** base point in raw coordinates */
  origin: { x: number; z: number };
  /** rotation applied to the raw points, rad */
  rotation: number;
  /** uniform scale applied after rotation */
  scale: number;
}

export function waypointFrame(spec: ShapeSpec, L: number): WaypointFrame {
  let raw = spec.waypoints.map((p) => ({ x: p.x * L, z: p.z * L }));
  if (raw.length < 2) raw = [{ x: 0, z: 0 }, { x: 0, z: L * 0.8 }];
  const origin = { ...raw[0] };
  const t0 = Math.atan2(raw[1].x - origin.x, raw[1].z - origin.z);
  const ca = Math.cos(-t0);
  const sa = Math.sin(-t0);
  const rotated = raw.map((p) => {
    const dx = p.x - origin.x;
    const dz = p.z - origin.z;
    return { x: dx * ca + dz * sa, z: -dx * sa + dz * ca };
  });
  const dense = catmullRom(rotated, 40);
  const cum = cumulative(dense);
  const scale = cum.total > 1e-6 ? L / cum.total : 1;
  return {
    points: rotated.map((p) => ({ x: p.x * scale, z: p.z * scale })),
    raw,
    origin,
    rotation: t0,
    scale,
  };
}

function fromWaypoints(spec: ShapeSpec, L: number): { samples: CurveSample[]; length: number } {
  const frame = waypointFrame(spec, L);
  const pts = frame.points;
  const dense = catmullRom(pts, 40);
  const cum = cumulative(dense);
  if (!(cum.total > 1e-6)) {
    return integrateProfile({ ...spec, preset: 'straight' }, L);
  }
  const scale = L / cum.total;
  const N = 800;
  const samples: CurveSample[] = [];
  let j = 0;
  for (let i = 0; i <= N; i++) {
    const target = (cum.total * i) / N;
    while (j < dense.length - 2 && cum.s[j + 1] < target) j++;
    const w = (target - cum.s[j]) / Math.max(1e-12, cum.s[j + 1] - cum.s[j]);
    const p = {
      x: (dense[j].x + (dense[j + 1].x - dense[j].x) * w) * scale,
      z: (dense[j].z + (dense[j + 1].z - dense[j].z) * w) * scale,
    };
    samples.push({ s: (L * i) / N, x: p.x, z: p.z, psi: 0, kappa: 0 });
  }
  // tangents and curvature by finite differences
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    samples[i].psi = Math.atan2(dx, dz);
  }
  for (let i = 1; i < samples.length - 1; i++) {
    let dpsi = samples[i + 1].psi - samples[i - 1].psi;
    while (dpsi > Math.PI) dpsi -= 2 * Math.PI;
    while (dpsi < -Math.PI) dpsi += 2 * Math.PI;
    samples[i].kappa = dpsi / Math.max(1e-9, samples[i + 1].s - samples[i - 1].s);
  }
  samples[0].kappa = samples[1].kappa;
  samples[samples.length - 1].kappa = samples[samples.length - 2].kappa;
  // light smoothing of curvature
  const sm = samples.map((p) => p.kappa);
  for (let i = 0; i < samples.length; i++) {
    let acc = 0;
    let cnt = 0;
    for (let k = -3; k <= 3; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < sm.length) {
        acc += sm[idx];
        cnt++;
      }
    }
    samples[i].kappa = acc / cnt;
  }
  return { samples, length: L };
}

export function compileDesiredCurve(spec: ShapeSpec, L: number): DesiredCurve {
  const length = Math.max(1, L);
  const built =
    spec.kind === 'waypoints' ? fromWaypoints(spec, length) : integrateProfile(spec, length);
  const samples = built.samples;
  const kappas = samples.map((p) => Math.abs(p.kappa));
  const maxKappa = kappas.reduce((a, b) => Math.max(a, b), 0);
  const tip = samples[samples.length - 1];
  const tipAngle = tip.psi;
  return {
    length,
    samples,
    maxKappa,
    tipAngle,
    poseAt: (s) => sampleAt(samples, s),
    kappaAt: (s) => sampleAt(samples, s).kappa,
    resample: (n) => {
      const out: ShapeSample[] = [];
      for (let i = 0; i < n; i++) {
        const p = sampleAt(samples, (length * i) / Math.max(1, n - 1));
        out.push({ s: p.s, x: p.x, z: p.z, psi: p.psi });
      }
      return out;
    },
  };
}

export function emptyShape(preset: ShapePreset = 'sCurve', kappaMax = 0.08): ShapeSpec {
  return { kind: 'preset', preset, kappaMax, waypoints: [] };
}

/** Build control points for a custom shape from the current desired curve. */
export function waypointsFromCurve(curve: DesiredCurve, count = 6): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const p = curve.poseAt((curve.length * i) / (count - 1));
    pts.push({ x: p.x / curve.length, z: p.z / curve.length });
  }
  return pts;
}

/** Nearest distance from a point to a polyline. */
export function distanceToPolyline(
  p: { x: number; z: number },
  poly: { x: number; z: number }[],
): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 1e-12 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
    if (d < best) best = d;
  }
  return best;
}

export function shapeLength(points: { x: number; z: number }[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    s += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return s;
}
