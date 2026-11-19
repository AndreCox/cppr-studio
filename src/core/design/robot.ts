import { designSegment } from './segment';
import { effectiveTransmissionPattern } from '../fab/transmission';
import type {
  ActuationState,
  Project,
  RobotResult,
  SegmentConfig,
  SegmentResult,
} from '../types';

type Vec3 = [number, number, number];
type Mat3 = [number, number, number, number, number, number, number, number, number];

const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

const rotY = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const rotZ = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

function quatFromMat(m: Mat3): [number, number, number, number] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let x = 0, y = 0, z = 0, w = 1;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

function poseAtShape(shape: { x: number; z: number; psi: number; s: number }[], s: number) {
  if (shape.length === 0) return { x: 0, z: 0, psi: 0, s: 0 };
  if (s <= 0) return shape[0];
  for (let i = 1; i < shape.length; i++) {
    if (shape[i].s >= s) {
      const a = shape[i - 1];
      const b = shape[i];
      const w = (s - a.s) / Math.max(1e-9, b.s - a.s);
      return {
        s,
        x: a.x + (b.x - a.x) * w,
        z: a.z + (b.z - a.z) * w,
        psi: a.psi + (b.psi - a.psi) * w,
      };
    }
  }
  return shape[shape.length - 1];
}

function pickState(res: SegmentResult, fraction: number): ActuationState | null {
  if (fraction === 1 && res.designState) return res.designState;
  if (res.sweep.length === 0) return res.designState;
  let best = res.sweep[0];
  let bestD = Infinity;
  for (const st of res.sweep) {
    if (!st.converged) continue;
    const d = Math.abs(st.q - fraction * res.qDesign);
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

/** Actuation state nearest the requested preview fraction. */
export function actuationAt(res: SegmentResult, fraction: number): ActuationState | null {
  return pickState(res, fraction);
}

export interface RobotAssembly {
  worldShape: [number, number, number][];
  worldSegments: RobotResult['worldSegments'];
  totalLength: number;
}

export interface AssemblyOptions {
  /** 1 = design actuation; negative values push the inner tubes */
  fraction?: number;
  segmentsOverride?: { id: string; state: ActuationState }[];
}

export function assembleRobot(
  project: Project,
  results: SegmentResult[],
  opts: AssemblyOptions = {},
): RobotAssembly {
  const fraction = opts.fraction ?? 1;
  const segments = project.segments.filter((s) => s.enabled);
  const worldSegments: RobotResult['worldSegments'] = [];
  let P: Vec3 = [0, 0, 0];
  let Q: Mat3 = I3;
  const worldShape: [number, number, number][] = [];
  let totalLength = 0;

  for (let k = 0; k < segments.length; k++) {
    const cfg = segments[k];
    const res = results.find((r) => r.segmentId === cfg.id);
    if (!res) continue;
    const override = opts.segmentsOverride?.find((o) => o.id === cfg.id)?.state;
    const state = override ?? pickState(res, fraction);
    if (!state || state.shape.length < 2) continue;
    const Q0 = mul(Q, rotZ((cfg.rollDeg * Math.PI) / 180));
    const P0 = P;
    const points: [number, number, number][] = [];
    const frames: { position: Vec3; quaternion: [number, number, number, number] }[] = [];
    for (const smp of state.shape) {
      const local: Vec3 = [smp.x, 0, smp.z];
      const q = apply(Q0, local);
      points.push([P0[0] + q[0], P0[1] + q[1], P0[2] + q[2]]);
    }
    const last = state.shape[state.shape.length - 1];
    Q = mul(Q0, rotY(last.psi));
    P = points[points.length - 1];
    totalLength += last.s;

    const notches = state.notchArcs.map((arc) => {
      const sc = 0.5 * (arc.sStart + arc.sEnd);
      const p = poseAtShape(state.shape, sc);
      const local: Vec3 = [p.x, 0, p.z];
      const q = apply(Q0, local);
      const qm = mul(Q0, rotY(p.psi));
      const notchRes = res.notches[arc.index];
      frames.push({
        position: [P0[0] + q[0], P0[1] + q[1], P0[2] + q[2]],
        quaternion: quatFromMat(qm),
      });
      return {
        position: [P0[0] + q[0], P0[1] + q[1], P0[2] + q[2]] as Vec3,
        quaternion: quatFromMat(qm),
        h: notchRes?.h ?? 2,
      };
    });
    worldSegments.push({
      segmentId: cfg.id,
      points,
      tip: points[points.length - 1],
      base: { position: P0, quaternion: quatFromMat(Q0) },
      frames,
      notches,
    });
    if (worldShape.length === 0) worldShape.push(...points);
    else worldShape.push(...points.slice(1));
  }
  return { worldShape, worldSegments, totalLength };
}

export function designProject(project: Project): RobotResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const segments: SegmentResult[] = [];
  const enabled = project.segments.filter((s) => s.enabled);

  for (let i = 0; i < enabled.length; i++) {
    const cfg = enabled[i];
    const res = designSegment(cfg, project.materials);
    segments.push(res);
    for (const e of res.errors) errors.push(`${cfg.name}: ${e}`);
    for (const w of res.warnings) warnings.push(`${cfg.name}: ${w}`);
    for (const i of res.info) info.push(`${cfg.name}: ${i}`);

    if (cfg.tipFeature?.enabled && i < enabled.length - 1) {
      warnings.push(
        `${cfg.name}: the tip cross-pin extension is enabled on a non-distal segment; it may interfere with the next pair. ` +
          'Enable it only on the final segment, or move it distally.',
      );
    } else if (cfg.tipFeature?.enabled) {
      info.push(
        `${cfg.name}: tip cross-pin at the distal tip (+${cfg.tipFeature.extension.toFixed(0)} mm tube extension, ` +
          `Ø${cfg.tipFeature.holeDiameter.toFixed(2)} mm hole ${cfg.tipFeature.holeDistance.toFixed(1)} mm from the tip).`,
      );
    }
    const outerSolid = effectiveTransmissionPattern(cfg, 'outer') === 'solid';
    const innerSolid = effectiveTransmissionPattern(cfg, 'inner') === 'solid';
    if (i > 0 && (outerSolid || innerSolid)) {
      const which = outerSolid && innerSolid ? 'both transmissions are' : outerSolid ? 'the outer transmission is' : 'the inner transmission is';
      warnings.push(
        `${cfg.name} is distal and passes through the proximal bending section, but ${which} solid. ` +
          'A solid transmission may be too stiff to follow the proximal bend; consider a discrete or brickwork flex pattern.',
      );
    }
    if (i === 0 && (!outerSolid || !innerSolid)) {
      info.push(
        `${cfg.name} is the proximal pair. Its transmission can be solid if it is only a rigid handle/sheath; ` +
          'use a flex pattern only if the pair must be routed through a curved channel. Outer and inner patterns can be set independently.',
      );
    }
  }

  for (let k = 1; k < enabled.length; k++) {
    const prev = enabled[k - 1];
    const cur = enabled[k];
    const prevInnerId = prev.innerTube.od - 2 * prev.innerTube.wall;
    const gap = (prevInnerId - cur.outerTube.od) / 2;
    if (gap < cur.minClearance - 5e-4) {
      warnings.push(
        `${cur.name} does not pass through ${prev.name}'s lumen: radial clearance ` +
          `${gap.toFixed(3)} mm (need ${cur.minClearance.toFixed(3)} mm). Increase the proximal ` +
          'inner tube or reduce the distal outer tube.',
      );
    }
    const upstreamLength = enabled.slice(0, k).reduce((a, s) => a + s.activeLength, 0);
    if (cur.transmission.length < upstreamLength * 0.9) {
      warnings.push(
        `${cur.name}'s transmission section is ${cur.transmission.length.toFixed(0)} mm but it must span the ` +
          `${upstreamLength.toFixed(0)} mm of upstream bending section to reach its active start. Increase the transmission length.`,
      );
    } else if (cur.transmission.length > upstreamLength + 60) {
      info.push(
        `${cur.name}'s transmission is ${(cur.transmission.length - upstreamLength).toFixed(0)} mm longer than the ` +
          'upstream bend length; that excess sits behind the base as a handle or coil. Shorten it if the tube is unwieldy.',
      );
    }
    if (prev.shape.kind === 'waypoints' || cur.shape.kind === 'waypoints') {
      info.push('Multi-segment assembly uses each segment as a planar arc stack; verify the mounting planes.');
    }
  }

  const anyError = errors.length > 0;
  const fraction = 1;
  const assembly = assembleRobot(project, segments, { fraction });
  if (segments.some((s) => !s.designState) && errors.length === 0) {
    errors.push('One or more segments could not be designed.');
  }
  if (enabled.length === 0) errors.push('No enabled segments.');

  return {
    ok: !anyError && errors.length === 0,
    segments,
    errors,
    warnings,
    info,
    worldShape: assembly.worldShape,
    worldSegments: assembly.worldSegments,
    totalLength: assembly.totalLength,
    dof: enabled.length * 3,
  };
}

export function segmentFor(cfg: SegmentConfig, project: Project): SegmentResult {
  return designSegment(cfg, project.materials);
}

export { rotY, rotZ, mul, apply, quatFromMat };
