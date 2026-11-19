import type { Project, RobotResult } from '../types';
import { solveCosserat, type CosseratOptions, type CosseratResult } from './solver';

export interface TipForce {
  /** Force magnitude in newtons. */
  magnitude: number;
  /** World-frame azimuth about +Z, degrees from +X. */
  azimuthDeg: number;
  /** World-frame elevation from the XY plane, degrees. */
  elevationDeg: number;
}

export interface TipStiffnessResult {
  force: TipForce;
  forceUnit: [number, number, number];
  forceVector: [number, number, number];
  baseline: CosseratResult;
  loaded: CosseratResult;
  baselineTip: [number, number, number];
  loadedTip: [number, number, number];
  displacement: [number, number, number];
  displacementMagnitude: number;
  /** Angle between the applied force and the tip displacement, degrees. */
  deflectionAngleDeg: number;
  /** Secant stiffness along the applied force: F / (Δ · n). Null for zero force or negative response. */
  effectiveStiffness: number | null;
  /** F / |Δ|. */
  overallStiffness: number | null;
  compliance: number | null;
  /** Change in the distal tip frame orientation, degrees. */
  tipRotationDeg: number;
  solveTimeMs: number;
  converged: boolean;
  message: string | null;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function tipForceUnit(force: Pick<TipForce, 'azimuthDeg' | 'elevationDeg'>): [number, number, number] {
  const az = rad(force.azimuthDeg);
  const el = rad(force.elevationDeg);
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

export function tipForceVector(force: TipForce): [number, number, number] {
  const [x, y, z] = tipForceUnit(force);
  const m = Math.max(0, force.magnitude);
  return [x * m, y * m, z * m];
}

function lastLeaderFrame(result: CosseratResult) {
  const section = result.sections[result.sections.length - 1];
  if (!section) return null;
  return section.leader[section.leader.length - 1] ?? null;
}

function tipRotationDeg(baseline: CosseratResult, loaded: CosseratResult): number {
  const a = lastLeaderFrame(baseline);
  const b = lastLeaderFrame(loaded);
  if (!a || !b) return 0;
  let trace = 0;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) trace += a.pose[k][i] * b.pose[k][i];
  }
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
}

export interface TipStiffnessOptions {
  fraction: number;
  gravityEnabled: boolean;
  plan2d: boolean;
  force: TipForce;
}

/**
 * Solve the full 3D Cosserat chain twice: once without an external tip load,
 * and once with a world-frame point force at the distal tip. The difference is
 * the tip deflection from that force at the current actuation pose.
 */
export async function solveTipStiffness(
  project: Project,
  result: RobotResult,
  opts: TipStiffnessOptions,
): Promise<TipStiffnessResult> {
  const force = { ...opts.force, magnitude: Math.max(0, opts.force.magnitude) };
  const rawUnit = tipForceUnit(force);
  // The planar reduction only carries the base bending plane (world X-Z).
  // Project the requested force into it so the 2D result remains well posed.
  const projected = opts.plan2d ? [rawUnit[0], 0, rawUnit[2]] as [number, number, number] : rawUnit;
  const projectedLength = Math.hypot(...projected);
  const forceUnit: [number, number, number] = projectedLength > 1e-9
    ? [projected[0] / projectedLength, projected[1] / projectedLength, projected[2] / projectedLength]
    : [0, 0, 0];
  const forceVector: [number, number, number] = [
    forceUnit[0] * force.magnitude,
    forceUnit[1] * force.magnitude,
    forceUnit[2] * force.magnitude,
  ];
  const base: CosseratOptions = {
    fraction: opts.fraction,
    gravityEnabled: opts.gravityEnabled,
    planar: opts.plan2d,
  };
  const baseline = await solveCosserat(project, result, base);
  const loaded = force.magnitude > 1e-12 && projectedLength > 1e-9
    ? await solveCosserat(project, result, {
        ...base,
        tipLoadWorld: [0, 0, 0, forceVector[0], forceVector[1], forceVector[2]],
      })
    : baseline;

  const baselineTip = baseline.tip;
  const loadedTip = loaded.tip;
  const displacement: [number, number, number] = [
    loadedTip[0] - baselineTip[0],
    loadedTip[1] - baselineTip[1],
    loadedTip[2] - baselineTip[2],
  ];
  const displacementMagnitude = Math.hypot(...displacement);
  const along = displacement[0] * forceUnit[0] + displacement[1] * forceUnit[1] + displacement[2] * forceUnit[2];
  const deflectionAngleDeg = displacementMagnitude > 1e-9
    ? (Math.acos(Math.max(-1, Math.min(1, along / displacementMagnitude))) * 180) / Math.PI
    : 0;
  const effectiveStiffness = along > 1e-9 ? force.magnitude / along : null;
  const overallStiffness = displacementMagnitude > 1e-9 ? force.magnitude / displacementMagnitude : null;
  const compliance = force.magnitude > 1e-12 && displacementMagnitude > 1e-9 ? displacementMagnitude / force.magnitude : null;
  const converged = baseline.converged && loaded.converged;
  const message = [baseline.message, loaded.message].filter(Boolean).join(' · ') || null;

  return {
    force,
    forceUnit,
    forceVector,
    baseline,
    loaded,
    baselineTip,
    loadedTip,
    displacement,
    displacementMagnitude,
    deflectionAngleDeg,
    effectiveStiffness,
    overallStiffness,
    compliance,
    tipRotationDeg: tipRotationDeg(baseline, loaded),
    solveTimeMs: baseline.solveTimeMs + loaded.solveTimeMs,
    converged,
    message,
  };
}
