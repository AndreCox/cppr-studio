import { describe, expect, it } from 'vitest';
import { PRINTED_DEMO, makeSegment } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { buildSegmentTubes, buildStlParts } from '../src/core/fab/build';
import { buildLaserPatterns } from '../src/core/fab/patterns';

function meshZRange(positions: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]);
    max = Math.max(max, positions[i]);
  }
  return { min, max };
}

describe('inner tube hand-actuation extension', () => {
  const cfg = makeSegment({
    name: 'extension test',
    innerExtension: 30,
    transmission: {
      ...PRINTED_DEMO().segments[1].transmission,
      length: 60,
    },
  });
  const project = { ...PRINTED_DEMO(), segments: [cfg] };
  const result = designProject(project);
  const res = result.segments[0];

  it('designs the segment and reports the extension', () => {
    expect(res.ok).toBe(true);
    expect(res.info.join(' ')).toMatch(/handle extension/i);
  });

  it('extends only the complete inner tube, not the tip-only build', () => {
    const tip = buildSegmentTubes(cfg, res, { includeTransmission: false });
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    expect(tip.inner.totalLength).toBeCloseTo(tip.outer.totalLength, 5);
    expect(full.inner.totalLength - full.outer.totalLength).toBeCloseTo(30, 5);
    expect(full.innerActiveStart - full.activeStart).toBeCloseTo(30, 5);
    expect(full.inner.totalLength).toBeCloseTo(full.outer.totalLength + 30, 5);
    const outerZ = meshZRange(full.outer.mesh.positions);
    const innerZ = meshZRange(full.inner.mesh.positions);
    expect(outerZ.max).toBeCloseTo(full.outer.totalLength, 4);
    expect(innerZ.max).toBeCloseTo(full.inner.totalLength, 4);
    // the inner tip is beyond the outer in its own frame; assembly aligns it by the extension
    expect(innerZ.max - outerZ.max).toBeGreaterThan(29);
  });

  it('shifts the inner laser pattern and includes the solid extension', () => {
    const patterns = buildLaserPatterns(cfg, res, true);
    const outer = patterns.find((p) => p.tube === 'outer')!;
    const inner = patterns.find((p) => p.tube === 'inner')!;
    expect(inner.length - outer.length).toBeCloseTo(30, 4);
    expect(inner.activeStart - outer.activeStart).toBeCloseTo(30, 4);
    expect(inner.notes.join(' ')).toMatch(/handle extension/i);
    const txMinInner = Math.min(...inner.regions.filter((r) => r.kind === 'transmission').map((r) => r.z0));
    const txMinOuter = Math.min(...outer.regions.filter((r) => r.kind === 'transmission').map((r) => r.z0));
    expect(txMinInner - txMinOuter).toBeCloseTo(30, 3);
  });

  it('keeps a solid extension before the first transmission slot in the mesh', () => {
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    const innerZ = meshZRange(full.inner.mesh.positions);
    // the mesh spans the full inner tube; the extension is solid (no features before leadIn+ext)
    expect(innerZ.min).toBeCloseTo(0, 4);
    expect(full.inner.transmissionCuts).toBeGreaterThan(0);
  });

  it('is included in the printed demo example', () => {
    const p = PRINTED_DEMO();
    expect(p.segments[0].innerExtension).toBeGreaterThan(0);
    expect(p.segments[1].innerExtension).toBeGreaterThan(p.segments[0].innerExtension);
  });
});

describe('connected solid outer transmission extension', () => {
  const cfg = makeSegment({
    name: 'coupled extension',
    outerExtension: 25,
    innerExtension: 20,
    transmission: {
      ...PRINTED_DEMO().segments[1].transmission,
      length: 60,
      coupler: { enabled: true, tubes: 'outer', length: 12 },
    },
  });
  const project = { ...PRINTED_DEMO(), segments: [cfg] };
  const result = designProject(project);
  const res = result.segments[0];

  it('reports the outer extension and solid end section in the design notes', () => {
    expect(res.ok).toBe(true);
    expect(res.info.join(' ')).toMatch(/outer tube solid extension/i);
    expect(res.info.join(' ')).toMatch(/solid proximal end section/i);
  });

  it('adds the solid section directly to the selected complete tube', () => {
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    expect(full.outerExtension).toBeCloseTo(37, 6);
    expect(full.innerExtension).toBeCloseTo(20, 6);
    expect(full.outer.totalLength).toBeGreaterThan(full.inner.totalLength);
    expect(full.outerActiveStart - full.innerActiveStart).toBeCloseTo(17, 6);
    const outerZ = meshZRange(full.outer.mesh.positions);
    expect(outerZ.min).toBeCloseTo(0, 4);
    expect(outerZ.max).toBeCloseTo(full.outer.totalLength, 4);
  });

  it('does not export a separate coupler and notes the solid section in the pattern', () => {
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    const parts = buildStlParts([{ cfg, res, fab: full }]);
    expect(parts.some((p) => p.fileName.endsWith('_coupler.stl'))).toBe(false);
    expect(parts.map((p) => p.fileName).sort()).toEqual([
      'cppr_coupled_extension_inner.stl',
      'cppr_coupled_extension_outer.stl',
    ]);
    const patterns = buildLaserPatterns(cfg, res, true);
    const outer = patterns.find((p) => p.tube === 'outer')!;
    const inner = patterns.find((p) => p.tube === 'inner')!;
    expect(outer.length - inner.length).toBeCloseTo(17, 4);
    expect(outer.notes.join(' ')).toMatch(/outer tube solid extension/i);
    expect(outer.notes.join(' ')).toMatch(/solid proximal end section/i);
    expect(inner.notes.join(' ')).toMatch(/handle extension/i);
  });
});
