import { describe, expect, it } from 'vitest';
import { meshToStep } from '../src/core/export/step';

// Outward-wound tetrahedron.
const mesh = {
  positions: [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ],
  triangles: [
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
    1, 2, 3,
  ],
  volume: 1 / 6,
};

describe('STEP export', () => {
  it('writes a faceted AP214 manifold solid', () => {
    const step = meshToStep([{ name: 'tetra', mesh }], 'tetra.step', 'tetra');
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    expect(step).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));");
    expect(step).toContain('MANIFOLD_SOLID_BREP');
    expect(step).toContain('CLOSED_SHELL');
    expect(step).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect((step.match(/ADVANCED_FACE/g) ?? []).length).toBe(4);
    expect(step.endsWith('END-ISO-10303-21;\n')).toBe(true);
  });

  it('adds more than one solid for a multi-part assembly', () => {
    const step = meshToStep([{ name: 'a', mesh }, { name: 'b', mesh }], 'assembly.step', 'assembly');
    expect((step.match(/MANIFOLD_SOLID_BREP/g) ?? []).length).toBe(2);
  });
});

import { PRINTED_DEMO } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { buildSegmentTubes } from '../src/core/fab/build';

function assertWatertight(positions: number[], triangles: number[]) {
  const key = (i: number) => `${positions[i * 3].toFixed(5)},${positions[i * 3 + 1].toFixed(5)},${positions[i * 3 + 2].toFixed(5)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = [triangles[t], triangles[t + 1], triangles[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = key(ids[k]);
      const b = key(ids[(k + 1) % 3]);
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  expect([...edges.values()].every((n) => n === 2)).toBe(true);
}

describe('STEP export of a printed tube', () => {
  it('exports a watertight complete tube as a manifold solid', () => {
    const project = PRINTED_DEMO();
    const result = designProject(project);
    const res = result.segments[0];
    const fab = buildSegmentTubes(project.segments[0], res, { includeTransmission: true });
    assertWatertight(fab.outer.mesh.positions, fab.outer.mesh.triangles);
    const step = meshToStep([{ name: 'outer', mesh: fab.outer.mesh }], 'outer.step', 'outer');
    const faces = fab.outer.mesh.triangles.length / 3;
    expect((step.match(/ADVANCED_FACE/g) ?? []).length).toBe(faces);
    expect(step).toContain('MANIFOLD_SOLID_BREP');
    expect(step.length).toBeGreaterThan(1000);
  });
});
