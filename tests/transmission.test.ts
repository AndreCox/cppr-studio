import { describe, expect, it } from 'vitest';
import { PRINTED_DEMO, PAPER_NITINOL, makeSegment } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { effectiveTransmissionPattern, transmissionDesign } from '../src/core/fab/transmission';
import { buildLaserPatterns } from '../src/core/fab/patterns';
import { buildSegmentTubes } from '../src/core/fab/build';

describe('transmission pattern geometry', () => {
  const cfg = PRINTED_DEMO().segments[1];
  const d = transmissionDesign(cfg, 'outer');

  it('uses multiple short circumferential slots per revolution', () => {
    expect(d.meta.pattern).toBe('discrete');
    expect(d.meta.slotsPerRev).toBe(4);
    expect(d.meta.slotAngleDeg).toBeCloseTo(65, 5);
    expect(d.meta.postDeg).toBeCloseTo(30, 5);
    expect(d.meta.bridgeDeg).toBeCloseTo(20, 5);
    expect(d.meta.segments).toBeGreaterThan(10);
    expect(d.meta.levels).toBe(3);
    // no slot is a nearly-full-circle band any more
    for (const c of d.cuts) {
      expect(c.angleSpan).toBeLessThan(Math.PI * 0.5);
      expect(c.angleSpan).toBeGreaterThan(0.2);
    }
  });

  it('conserves the circumference of each row', () => {
    const rowZ = d.cuts[0].z0;
    const row = d.cuts.filter((c) => Math.abs(c.z0 - rowZ) < 1e-9);
    expect(row).toHaveLength(4);
    const slots = row.reduce((a, c) => a + c.angleSpan, 0);
    const gaps = 2 * (d.meta.postDeg * Math.PI) / 180 + 2 * (d.meta.bridgeDeg * Math.PI) / 180;
    expect(slots + gaps).toBeCloseTo(2 * Math.PI, 6);
  });

  it('keeps a solid proximal lead-in and fits within the transmission length', () => {
    expect(d.meta.leadIn).toBeGreaterThan(0);
    expect(Math.min(...d.cuts.map((c) => c.z0))).toBeGreaterThanOrEqual(d.meta.leadIn - 1e-9);
    expect(Math.max(...d.cuts.map((c) => c.z1))).toBeLessThanOrEqual(cfg.transmission.length + 1e-9);
  });

  it('reports a printable minimum feature for the printed demo', () => {
    expect(d.meta.minFeature).toBeGreaterThanOrEqual(0.4);
  });

  it('warns when the transmission features are laser-scale only', () => {
    const laser = makeSegment({
      transmission: { ...cfg.transmission, kerf: 0.08, pitch: 0.35, levels: 6, cutsPerRev: 6, separationDeg: 15, overlapDeg: 15 },
    });
    const ld = transmissionDesign(laser, 'outer');
    expect(ld.meta.minFeature).toBeLessThan(0.4);
    expect(ld.notes.join(' ')).toMatch(/FDM|0\.4 mm/);
  });
});

describe('laser pattern output for the transmission', () => {
  const project = PRINTED_DEMO();
  const result = designProject(project);
  const cfg = project.segments[1];
  const res = result.segments[1];
  const patterns = buildLaserPatterns(cfg, res, true);

  it('emits short slot rectangles, not giant wrapped bands', () => {
    for (const p of patterns) {
      const tx = p.regions.filter((r) => r.kind === 'transmission');
      expect(tx.length).toBeGreaterThan(100);
      const maxWidth = Math.max(...tx.map((r) => r.u1 - r.u0));
      expect(maxWidth / p.circumference).toBeLessThan(0.3);
      const minWidth = Math.min(...tx.map((r) => r.u1 - r.u0));
      expect(minWidth).toBeGreaterThan(0.05);
    }
  });

  it('has no overlapping slots within a row', () => {
    const p = patterns.find((x) => x.tube === 'outer')!;
    const byZ = new Map<number, { u0: number; u1: number }[]>();
    for (const r of p.regions.filter((x) => x.kind === 'transmission')) {
      const key = Math.round(r.z0 * 1000);
      const arr = byZ.get(key) ?? [];
      arr.push({ u0: r.u0, u1: r.u1 });
      byZ.set(key, arr);
    }
    for (const arr of byZ.values()) {
      arr.sort((a, b) => a.u0 - b.u0);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].u0 < arr[i - 1].u1 - 1e-6 && arr[i - 1].u1 < p.circumference - 1e-6) {
          // a wrapped slot produces one rectangle at each seam; ignore those
          expect(arr[i].u0).toBeGreaterThanOrEqual(arr[i - 1].u1 - 1e-6);
        }
      }
    }
  });
});

describe('printable transmission mesh', () => {
  const project = PRINTED_DEMO();
  const result = designProject(project);
  const cfg = project.segments[1];
  const res = result.segments[1];

  it('includes the transmission slots in the full-tube STL mesh', () => {
    const active = buildSegmentTubes(cfg, res, { includeTransmission: false });
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    expect(active.outer.transmissionCuts).toBe(0);
    expect(full.outer.transmissionCuts).toBeGreaterThan(100);
    expect(full.inner.transmissionCuts).toBeGreaterThan(100);
    expect(full.outer.mesh.triangles.length).toBeGreaterThan(active.outer.mesh.triangles.length * 2);
    expect(full.outer.totalLength).toBeGreaterThan(active.outer.totalLength);
  });

  it('is watertight with the transmission slots', () => {
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    const mesh = full.outer.mesh;
    const edges = new Map<string, number>();
    const key = (i: number) => {
      const q = mesh.positions;
      return `${q[i * 3].toFixed(4)},${q[i * 3 + 1].toFixed(4)},${q[i * 3 + 2].toFixed(4)}`;
    };
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      const k = [0, 1, 2].map((j) => key(mesh.triangles[t + j]));
      for (let e = 0; e < 3; e++) {
        const a = k[e];
        const b = k[(e + 1) % 3];
        const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(ek, (edges.get(ek) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const c of edges.values()) if (c !== 2) open++;
    expect(open).toBe(0);
    expect(mesh.volume).toBeGreaterThan(0);
  });

  it('works for the paper nitinol geometry too (solid transmission)', () => {
    const p = PAPER_NITINOL();
    const r = designProject({ ...PRINTED_DEMO(), segments: [p] });
    const fab = buildSegmentTubes(p, r.segments[0], { includeTransmission: true });
    expect(fab.outer.transmissionCuts).toBe(0);
    expect(fab.outer.mesh.triangles.length).toBeGreaterThan(100);
  });
});

describe('brickwork transmission', () => {
  it('generates staggered short slots and a printable mesh', () => {
    const cfg = makeSegment({
      transmission: {
        ...PRINTED_DEMO().segments[0].transmission,
        pattern: 'brickwork',
        cutsPerRev: 4,
        kerf: 0.6,
        pitch: 1.2,
        overlapDeg: 20,
      },
    });
    const d = transmissionDesign(cfg, 'outer');
    expect(d.cuts.length).toBeGreaterThan(20);
    for (const c of d.cuts) expect(c.angleSpan).toBeLessThan(Math.PI);
    const project = { ...PRINTED_DEMO(), segments: [cfg] };
    const res = designProject(project);
    const fab = buildSegmentTubes(cfg, res.segments[0], { includeTransmission: true });
    expect(fab.outer.transmissionCuts).toBe(d.cuts.length);
    expect(fab.outer.mesh.volume).toBeGreaterThan(0);
  });
});

describe('per-tube transmission patterns', () => {
  const base = PRINTED_DEMO().segments[1];
  const cfg = { ...base, transmission: { ...base.transmission, pattern: 'solid' as const, innerPattern: 'discrete' as const } };
  const project = { ...PRINTED_DEMO(), segments: [cfg] };
  const res = designProject(project).segments[0];

  it('uses the effective pattern for each tube', () => {
    expect(effectiveTransmissionPattern(cfg, 'outer')).toBe('solid');
    expect(effectiveTransmissionPattern(cfg, 'inner')).toBe('discrete');
    expect(transmissionDesign(cfg, 'outer').cuts).toHaveLength(0);
    expect(transmissionDesign(cfg, 'inner').cuts.length).toBeGreaterThan(0);
  });

  it('builds a solid outer tube and a patterned inner tube', () => {
    const fab = buildSegmentTubes(cfg, res, { includeTransmission: true });
    expect(fab.outer.transmissionCuts).toBe(0);
    expect(fab.inner.transmissionCuts).toBeGreaterThan(0);
    expect(fab.outer.totalLength).toBeCloseTo(fab.inner.totalLength - cfg.innerExtension, 5);
    const patterns = buildLaserPatterns(cfg, res, true);
    expect(patterns.find((p) => p.tube === 'outer')!.regions.filter((r) => r.kind === 'transmission')).toHaveLength(0);
    expect(patterns.find((p) => p.tube === 'inner')!.regions.filter((r) => r.kind === 'transmission').length).toBeGreaterThan(0);
  });

  it('makes the printed demo proximal pair solid and the distal pair flexible', () => {
    const p = PRINTED_DEMO();
    expect(effectiveTransmissionPattern(p.segments[0], 'outer')).toBe('solid');
    expect(effectiveTransmissionPattern(p.segments[0], 'inner')).toBe('solid');
    expect(effectiveTransmissionPattern(p.segments[1], 'outer')).toBe('discrete');
    expect(effectiveTransmissionPattern(p.segments[1], 'inner')).toBe('discrete');
  });

  it('warns when a distal pair has a solid transmission', () => {
    const distalSolid = { ...PRINTED_DEMO().segments[1], transmission: { ...PRINTED_DEMO().segments[1].transmission, pattern: 'solid' as const, innerPattern: 'same' as const } };
    const result = designProject({ ...PRINTED_DEMO(), segments: [PRINTED_DEMO().segments[0], distalSolid] });
    expect(result.warnings.join(' ')).toMatch(/distal.*solid|solid transmission/i);
  });
});
