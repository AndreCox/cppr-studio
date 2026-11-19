import { describe, expect, it } from 'vitest';
import { tubesToStep } from '../src/core/export/step';

describe('smooth tube STEP export', () => {
  const tube = { name: 'outer tube', od: 16, id: 13.4, length: 100 };

  it('writes a smooth AP214 manifold solid', () => {
    const step = tubesToStep([tube], 'outer.step', 'outer');
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    expect(step).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));");
    expect(step).toContain('MANIFOLD_SOLID_BREP');
    expect(step).toContain('CLOSED_SHELL');
    expect(step).toContain('CYLINDRICAL_SURFACE');
    expect(step).toContain('CIRCLE');
    expect(step).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect((step.match(/ADVANCED_FACE/g) ?? []).length).toBe(4);
    expect(step.length).toBeLessThan(20000);
    expect(step.endsWith('END-ISO-10303-21;\n')).toBe(true);
  });

  it('adds a separate solid for each tube', () => {
    const step = tubesToStep([tube, { ...tube, name: 'inner', od: 13, id: 10.6, length: 120 }], 'assembly.step', 'assembly');
    expect((step.match(/MANIFOLD_SOLID_BREP/g) ?? []).length).toBe(2);
    expect((step.match(/ADVANCED_FACE/g) ?? []).length).toBe(8);
  });

  it('uses the real complete-tube dimensions', () => {
    const project = PRINTED_DEMO();
    const result = designProject(project);
    const fab = buildSegmentTubes(project.segments[0], result.segments[0], { includeTransmission: true });
    const step = tubesToStep([{ name: 'outer', od: fab.outer.od, id: fab.outer.id, length: fab.outer.totalLength }], 'outer.step', 'outer');
    expect(step).toContain(stepReal(fab.outer.totalLength));
    expect(step).toContain(stepReal(fab.outer.od / 2));
  });
});

function stepReal(v: number): string {
  if (Math.abs(v) < 1e-12) return '0.';
  let s = v.toPrecision(9);
  if (s.includes('e')) s = s.replace('e', 'E');
  if (!s.includes('.') && !s.includes('E')) s += '.';
  return s;
}

import { PRINTED_DEMO } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { buildSegmentTubes } from '../src/core/fab/build';
