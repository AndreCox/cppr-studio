import { describe, expect, it } from 'vitest';
import { PRINTED_DEMO } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import {
  analyticCurve,
  curveMetrics,
  localizeSection,
  resampleCurve,
  sectionFor,
  targetCurve,
} from '../src/core/cosserat/compare';
import type { CosseratFrame, CosseratResult, CosseratSectionResult } from '../src/core/cosserat/solver';

const project = PRINTED_DEMO();
const result = designProject(project);

function frame(sMm: number, z: number): CosseratFrame {
  return {
    sMm,
    pose: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, z],
      [0, 0, 0, 1],
    ],
    centroidOffsetMm: 0,
  };
}

function section(): CosseratSectionResult {
  return {
    centerline: [
      [0, 0, 0],
      [0, 0, 10],
      [5, 0, 20],
    ],
    leader: [frame(0, 0), frame(5, 10), frame(10, 20)],
    follower: [],
  };
}

describe('model comparison math', () => {
  it('localizes a solved section into its bending plane', () => {
    const local = localizeSection(section());
    expect(local.points).toHaveLength(3);
    expect(local.points[0]).toEqual({ x: 0, z: 0 });
    expect(local.points[1]).toEqual({ x: 0, z: 10 });
    expect(local.points[2]).toEqual({ x: 5, z: 20 });
    expect(local.outOfPlane).toBeCloseTo(0, 9);
  });

  it('resamples by arc length and reports tip/RMS error', () => {
    const samples = resampleCurve([{ x: 0, z: 0 }, { x: 0, z: 10 }], 5);
    expect(samples).toHaveLength(5);
    expect(samples[0]).toEqual({ x: 0, z: 0 });
    expect(samples.at(-1)).toEqual({ x: 0, z: 10 });
    expect(samples[2].z).toBeCloseTo(5, 6);

    const metrics = curveMetrics(
      [{ x: 1, z: 0 }, { x: 1, z: 10 }],
      [{ x: 0, z: 0 }, { x: 0, z: 10 }],
    );
    expect(metrics?.tipError).toBeCloseTo(1, 6);
    expect(metrics?.rms).toBeCloseTo(1, 6);
    expect(metrics?.targetTip).toEqual({ x: 0, z: 10 });
  });

  it('builds target and analytic curves and finds the selected section', () => {
    const target = targetCurve(result.segments[0]);
    const analytic = analyticCurve(result.segments[0], 1);
    expect(target.length).toBeGreaterThan(2);
    expect(analytic.length).toBeGreaterThan(2);
    expect(target.at(-1)?.z).toBeCloseTo(analytic.at(-1)?.z ?? -1, 0);

    const segmentId = project.segments[0].id;
    const cosserat: CosseratResult = {
      ok: true,
      converged: true,
      iterations: 4,
      residual: 1e-9,
      solveTimeMs: 5,
      message: null,
      centerline: section().centerline,
      tip: [5, 0, 20],
      segmentIds: [segmentId],
      sections: [section()],
    };
    expect(sectionFor(cosserat, segmentId)?.centerline).toHaveLength(3);
    expect(sectionFor(cosserat, 'missing')).toBeNull();
  });
});
