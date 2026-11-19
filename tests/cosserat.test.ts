import { describe, expect, it } from 'vitest';
import { PRINTED_DEMO } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { buildCosseratRequest, type CosseratFrame, type CosseratResult } from '../src/core/cosserat/solver';
import { buildCosseratAssembly } from '../src/core/cosserat/assembly';

describe('Cosserat bridge', () => {
  const project = PRINTED_DEMO();
  const result = designProject(project);

  it('maps designed sections into the rod-solver contract', () => {
    const { request, segmentIds } = buildCosseratRequest(project, result, {
      fraction: 1,
      gravityEnabled: false,
      planar: true,
    });
    const req = request as {
      sections: {
        radius_outer_mm: number;
        notch_count: number;
        push_pull_mm: number;
        roll_before_deg: number;
        notch_depths_outer_mm: number[];
        notch_depths_inner_mm: number[];
        material: { youngs_modulus_pa: number };
      }[];
      planar: boolean;
      gravity_enabled: boolean;
    };
    const enabled = project.segments.filter((s) => s.enabled);
    expect(segmentIds).toEqual(enabled.map((s) => s.id));
    expect(req.sections).toHaveLength(2);
    expect(req.planar).toBe(true);
    expect(req.gravity_enabled).toBe(false);
    expect(req.sections[0].radius_outer_mm).toBe(8);
    expect(req.sections[0].notch_count).toBe(12);
    expect(req.sections[0].notch_depths_outer_mm).toHaveLength(12);
    expect(req.sections[0].notch_depths_inner_mm).toHaveLength(12);
    expect(req.sections[0].push_pull_mm).toBeCloseTo(-result.segments[0].qDesign, 8);
    expect(req.sections[1].roll_before_deg).toBe(90);
    expect(req.sections[0].material.youngs_modulus_pa).toBeGreaterThan(1e8);

    const single = buildCosseratRequest(project, result, {
      fraction: 1,
      gravityEnabled: false,
      planar: true,
      onlySegmentId: enabled[0].id,
      centroidScale: 1.27,
    });
    const singleReq = single.request as { sections: unknown[]; centroid_scale?: number };
    expect(single.segmentIds).toEqual([enabled[0].id]);
    expect(singleReq.sections).toHaveLength(1);
    expect(singleReq.centroid_scale).toBe(1.27);
  });

  it('places notch frames and tips in the renderer assembly', () => {
    const frame = (sMm: number, z: number): CosseratFrame => ({
      sMm,
      pose: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, z],
        [0, 0, 0, 1],
      ],
      centroidOffsetMm: 0,
    });
    const segmentId = project.segments[0].id;
    const cosserat: CosseratResult = {
      ok: true,
      converged: true,
      iterations: 3,
      residual: 1e-9,
      solveTimeMs: 5,
      message: null,
      centerline: [
        [0, 0, 0],
        [0, 0, 40],
        [10, 0, 80],
      ],
      tip: [10, 0, 80],
      segmentIds: [segmentId],
      sections: [
        {
          centerline: [
            [0, 0, 0],
            [0, 0, 40],
            [10, 0, 80],
          ],
          leader: [frame(0, 0), frame(5, 5), frame(10, 10)],
          follower: [],
        },
      ],
    };
    const assembly = buildCosseratAssembly(project, result, cosserat);
    expect(assembly.worldSegments).toHaveLength(1);
    expect(assembly.worldSegments[0].segmentId).toBe(segmentId);
    expect(assembly.worldSegments[0].points).toHaveLength(3);
    expect(assembly.worldSegments[0].tip).toEqual([10, 0, 80]);
    expect(assembly.worldSegments[0].notches.length).toBe(result.segments[0].notches.length);
    expect(assembly.worldShape).toHaveLength(3);
    expect(assembly.worldShape.at(-1)).toEqual([10, 0, 80]);
  });
});

describe('tip stiffness request', () => {
  it('passes a world-frame tip wrench to the solver', () => {
    const project = PRINTED_DEMO();
    const result = designProject(project);
    const built = buildCosseratRequest(project, result, {
      fraction: 1,
      gravityEnabled: false,
      planar: false,
      tipLoadWorld: [0, 0, 0, 0.1, 0, 0],
    });
    expect((built.request as { tip_load_world: number[] }).tip_load_world).toEqual([0, 0, 0, 0.1, 0, 0]);
  });
});
