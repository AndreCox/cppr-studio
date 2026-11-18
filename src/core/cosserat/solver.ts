import init, { solve_chain } from '../../wasm/pkg/cppr_cosserat_wasm.js';
import type { Project, RobotResult, SegmentResult } from '../types';
import { findMaterial } from '../materials';

export type SolverMode = 'analytic' | 'cosserat';

export interface CosseratFrame {
  sMm: number;
  pose: [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]];
  centroidOffsetMm: number;
}

export interface CosseratSectionResult {
  centerline: [number, number, number][];
  leader: CosseratFrame[];
  follower: CosseratFrame[];
}

export interface CosseratResult {
  ok: boolean;
  converged: boolean;
  iterations: number;
  residual: number;
  solveTimeMs: number;
  message: string | null;
  centerline: [number, number, number][];
  tip: [number, number, number];
  sections: CosseratSectionResult[];
  /** Enabled app segments in the same order as `sections`. */
  segmentIds: string[];
}

export interface CosseratOptions {
  /** Actuation preview fraction; 1 = the design push/pull. */
  fraction: number;
  gravityEnabled: boolean;
  /**
   * Use the paper's planar (2D) reduction. This converges reliably and is the
   * right model for the app's planar notch schedules; full 3D is available for
   * out-of-plane loads but is slower and can need more iterations.
   */
  planar: boolean;
}

interface RawFrame {
  s_mm: number;
  pose: CosseratFrame['pose'];
  centroid_offset_mm: number;
}

interface RawSection {
  centerline: [number, number, number][];
  leader: RawFrame[];
  follower: RawFrame[];
}

interface RawResult {
  ok: boolean;
  converged: boolean;
  iterations: number;
  residual: number;
  solve_time_ms: number;
  message: string | null;
  centerline: [number, number, number][];
  tip: [number, number, number];
  sections: RawSection[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Builds the JSON contract consumed by the Rust solver.
 *
 * The Cosserat model uses a constant notch length and spacing per section, so
 * the app's (slightly varying) notch lengths are averaged. Per-notch depths
 * are passed through exactly. The solver uses one material per section; the
 * outer tube's material is used for both tubes.
 */
export function buildCosseratRequest(
  project: Project,
  result: RobotResult,
  opts: CosseratOptions,
): { request: unknown; segmentIds: string[] } {
  const sections: unknown[] = [];
  const segmentIds: string[] = [];
  for (const cfg of project.segments.filter((s) => s.enabled)) {
    const res: SegmentResult | undefined = result.segments.find((r) => r.segmentId === cfg.id);
    if (!res || res.notches.length === 0) continue;
    const n = res.notches.length;
    const notchLength = mean(res.notches.map((notch) => notch.h));
    const uncut = mean(res.notches.map((notch) => notch.c));
    const endLength = res.notches[n - 1].c;
    const material = findMaterial(project.materials, cfg.outerTube.materialId);
    sections.push({
      radius_outer_mm: cfg.outerTube.od / 2,
      radius_inner_mm: cfg.innerTube.od / 2,
      wall_outer_mm: cfg.outerTube.wall,
      wall_inner_mm: cfg.innerTube.wall,
      notch_length_mm: notchLength,
      uncut_length_mm: uncut,
      notch_count: n,
      end_length_mm: endLength,
      notch_depths_outer_mm: res.notches.map((notch) => notch.gOuter),
      notch_depths_inner_mm: res.notches.map((notch) => notch.gInner),
      // The app's q is positive toward +X; the rod solver's push/pull has the
      // opposite sign convention, so negate it here.
      push_pull_mm: -res.qDesign * opts.fraction,
      roll_before_deg: cfg.rollDeg,
      material: {
        youngs_modulus_pa: material.E * 1e6,
        poisson_ratio: material.nu,
        density_kg_m3: material.density * 1000,
      },
    });
    segmentIds.push(cfg.id);
  }
  return {
    request: {
      sections,
      gravity_enabled: opts.gravityEnabled,
      gravity_m_s2: [0, 0, -9.81],
      planar: opts.planar,
      samples_per_notch: 6,
      curvature_modes: opts.planar ? 2 : 3,
      torsion_modes: opts.planar ? 0 : 2,
    },
    segmentIds,
  };
}

let wasmReady: Promise<unknown> | null = null;

async function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = init();
  await wasmReady;
}

export async function solveCosserat(
  project: Project,
  result: RobotResult,
  opts: CosseratOptions,
): Promise<CosseratResult> {
  const built = buildCosseratRequest(project, result, opts);
  if (built.segmentIds.length === 0) {
    throw new Error('No designed segments to solve.');
  }
  await ensureWasm();
  const raw = JSON.parse(solve_chain(JSON.stringify(built.request))) as RawResult;
  const mapFrame = (frame: RawFrame): CosseratFrame => ({
    sMm: frame.s_mm,
    pose: frame.pose,
    centroidOffsetMm: frame.centroid_offset_mm,
  });
  return {
    ok: raw.ok,
    converged: raw.converged,
    iterations: raw.iterations,
    residual: raw.residual,
    solveTimeMs: raw.solve_time_ms,
    message: raw.message,
    centerline: raw.centerline,
    tip: raw.tip,
    sections: raw.sections.map((section) => ({
      centerline: section.centerline,
      leader: section.leader.map(mapFrame),
      follower: section.follower.map(mapFrame),
    })),
    segmentIds: built.segmentIds,
  };
}
