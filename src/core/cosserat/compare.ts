import type { SegmentResult } from '../types';
import { actuationAt } from '../design/robot';
import type { CosseratResult, CosseratSectionResult } from './solver';

export interface CurvePoint { x: number; z: number }

export interface LocalCurve {
  points: CurvePoint[];
  /** Maximum distance outside the local bending plane, mm. */
  outOfPlane: number;
}

/** The target centreline in the segment's local X–Z plane. */
export function targetCurve(res: SegmentResult): CurvePoint[] {
  return res.desiredShape.map((p) => ({ x: p.x, z: p.z }));
}

/** The analytic model's centreline at the requested actuation fraction. */
export function analyticCurve(res: SegmentResult, fraction: number): CurvePoint[] {
  const state = actuationAt(res, fraction);
  return state ? state.shape.map((p) => ({ x: p.x, z: p.z })) : [];
}

/**
 * Expresses a solved 3D section in its own base frame. The X–Z plane is the
 * bending plane used by the design canvas; Y is the out-of-plane deflection.
 */
export function localizeSection(section: CosseratSectionResult): LocalCurve {
  const base = section.leader[0];
  if (!base || section.centerline.length === 0) return { points: [], outOfPlane: 0 };
  const [px, py, pz] = section.centerline[0];
  const R = base.pose;
  let outOfPlane = 0;
  const points: CurvePoint[] = section.centerline.map(([x, y, z]) => {
    const dx = x - px;
    const dy = y - py;
    const dz = z - pz;
    const lx = R[0][0] * dx + R[1][0] * dy + R[2][0] * dz;
    const ly = R[0][1] * dx + R[1][1] * dy + R[2][1] * dz;
    const lz = R[0][2] * dx + R[1][2] * dy + R[2][2] * dz;
    outOfPlane = Math.max(outOfPlane, Math.abs(ly));
    return { x: lx, z: lz };
  });
  return { points, outOfPlane };
}

export function sectionFor(cosserat: CosseratResult, segmentId: string): CosseratSectionResult | null {
  const index = cosserat.segmentIds.indexOf(segmentId);
  return index >= 0 ? cosserat.sections[index] ?? null : null;
}

/** Resamples a polyline at equal arc-length intervals. */
export function resampleCurve(points: CurvePoint[], count = 80): CurvePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1 || count < 2) return points.slice();
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    lengths.push(total);
  }
  if (total < 1e-9) return points.slice();
  const out: CurvePoint[] = [];
  let segment = 1;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (segment < points.length - 1 && lengths[segment] < target) segment++;
    const s0 = lengths[segment - 1];
    const s1 = lengths[segment];
    const w = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
    const a = points[segment - 1];
    const b = points[segment];
    out.push({ x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w });
  }
  return out;
}

export interface CurveMetrics {
  tipError: number;
  rms: number;
  modelTip: CurvePoint;
  targetTip: CurvePoint;
}

/** Tip and RMS distance from a model centreline to the target, in mm. */
export function curveMetrics(model: CurvePoint[], target: CurvePoint[]): CurveMetrics | null {
  if (model.length < 2 || target.length < 2) return null;
  const a = resampleCurve(model);
  const b = resampleCurve(target);
  const n = Math.min(a.length, b.length);
  if (n === 0) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (a[i].x - b[i].x) ** 2 + (a[i].z - b[i].z) ** 2;
  }
  const modelTip = model[model.length - 1];
  const targetTip = target[target.length - 1];
  return {
    tipError: Math.hypot(modelTip.x - targetTip.x, modelTip.z - targetTip.z),
    rms: Math.sqrt(sum / n),
    modelTip,
    targetTip,
  };
}
