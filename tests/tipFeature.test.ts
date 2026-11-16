import { describe, expect, it } from 'vitest';
import { PRINTED_DEMO } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { buildSegmentTubes } from '../src/core/fab/build';
import { buildTipExtension } from '../src/core/fab/tipFeature';
import type { Mesh } from '../src/core/fab/tubeMesh';

function zRange(positions: number[]) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]);
    max = Math.max(max, positions[i]);
  }
  return { min, max };
}

function openEdges(mesh: Mesh): number {
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
  return open;
}

describe('tip cross-pin extension', () => {
  const project = PRINTED_DEMO();
  const cfg = project.segments[1];
  const res = designProject(project).segments[1];

  it('is enabled on the distal demo segment and off on the proximal one', () => {
    expect(PRINTED_DEMO().segments[0].tipFeature.enabled).toBe(false);
    expect(PRINTED_DEMO().segments[1].tipFeature.enabled).toBe(true);
  });

  it('extends both tube tips and stays watertight', () => {
    const full = buildSegmentTubes(cfg, res, { includeTransmission: true });
    const outerZ = zRange(full.outer.mesh.positions);
    const innerZ = zRange(full.inner.mesh.positions);
    expect(full.outer.tipExtension).toBe(cfg.tipFeature.extension);
    expect(full.inner.tipExtension).toBe(cfg.tipFeature.extension);
    expect(outerZ.max).toBeGreaterThan(full.outer.totalLength - cfg.tipFeature.extension + cfg.tipFeature.extension * 0.8);
    expect(innerZ.max).toBeGreaterThan(full.inner.totalLength - cfg.tipFeature.extension + cfg.tipFeature.extension * 0.8);
    expect(openEdges(full.outer.mesh)).toBe(0);
    expect(openEdges(full.inner.mesh)).toBe(0);
    expect(full.outer.mesh.volume).toBeGreaterThan(0);
    expect(full.inner.mesh.volume).toBeGreaterThan(0);
  });

  it('adds material to both tubes and can be disabled', () => {
    const withTip = buildSegmentTubes(cfg, res, { includeTransmission: true });
    const withoutCfg = { ...cfg, tipFeature: { ...cfg.tipFeature, enabled: false } };
    const without = buildSegmentTubes(withoutCfg, res, { includeTransmission: true });
    expect(withTip.outer.mesh.volume).toBeGreaterThan(without.outer.mesh.volume + 10);
    expect(withTip.inner.mesh.volume).toBeGreaterThan(without.inner.mesh.volume + 10);
    expect(withTip.outer.totalLength - without.outer.totalLength).toBeCloseTo(cfg.tipFeature.extension, 5);
    expect(withTip.inner.totalLength - without.inner.totalLength).toBeCloseTo(cfg.tipFeature.extension, 5);
    expect(buildTipExtension(withoutCfg, { od: cfg.outerTube.od, id: cfg.outerTube.od - 2 * cfg.outerTube.wall }, 100)).toBeNull();
  });

  it('is also present in the tip-only STLs for both tubes', () => {
    const tip = buildSegmentTubes(cfg, res, { includeTransmission: false });
    expect(tip.outer.tipExtension).toBe(cfg.tipFeature.extension);
    expect(tip.inner.tipExtension).toBe(cfg.tipFeature.extension);
    expect(zRange(tip.outer.mesh.positions).max).toBeGreaterThan(tip.outer.totalLength - 1);
    expect(zRange(tip.inner.mesh.positions).max).toBeGreaterThan(tip.inner.totalLength - 1);
  });

  it('has a diametric through-hole in the collar', () => {
    const tube = { od: cfg.outerTube.od, id: cfg.outerTube.od - 2 * cfg.outerTube.wall };
    const tipZ = 120;
    const ext = buildTipExtension(cfg, tube, tipZ);
    expect(ext).not.toBeNull();
    if (!ext) return;
    const z = zRange(ext.positions);
    expect(z.max).toBeCloseTo(tipZ + cfg.tipFeature.extension, 3);
    expect(ext.volume).toBeGreaterThan(0);
    expect(openEdges(ext)).toBe(0);
    // A larger hole removes more material than a smaller one.
    const smallCfg = { ...cfg, tipFeature: { ...cfg.tipFeature, holeDiameter: 1.2 } };
    const small = buildTipExtension(smallCfg, tube, tipZ);
    expect(small).not.toBeNull();
    if (small) expect(ext.volume).toBeLessThan(small.volume);
  });

  it('warns when enabled on a non-distal segment', () => {
    const p = PRINTED_DEMO();
    const proximal = { ...p.segments[0], tipFeature: { ...p.segments[1].tipFeature, enabled: true } };
    const result = designProject({ ...p, segments: [proximal, p.segments[1]] });
    expect(result.warnings.join(' ')).toMatch(/non-distal|cross-pin/i);
  });
});

import { buildLaserPatterns, patternToDxf, patternToSvg } from '../src/core/fab/patterns';

describe('cross-pin holes in the laser pattern', () => {
  const cfg = PRINTED_DEMO().segments[1];
  const res = designProject(PRINTED_DEMO()).segments[1];
  const patterns = buildLaserPatterns(cfg, res, true);

  it('places two 180°-apart holes near each tube tip', () => {
    expect(patterns).toHaveLength(2);
    for (const p of patterns) {
      expect(p.holes).toHaveLength(2);
      expect(p.length - p.activeEnd).toBeCloseTo(cfg.tipFeature.extension, 3);
      const zH = p.length - cfg.tipFeature.holeDistance;
      for (const h of p.holes) {
        expect(h.z).toBeCloseTo(zH, 5);
        expect(h.diameter).toBeCloseTo(cfg.tipFeature.holeDiameter, 5);
      }
      const gap = Math.abs(p.holes[0].u - p.holes[1].u);
      const wrapped = Math.min(gap, p.circumference - gap);
      expect(wrapped).toBeCloseTo(Math.PI * p.radius, 3);
    }
  });

  it('exports circle entities for the holes', () => {
    const svg = patternToSvg(patterns, 'test', 'cross-pin');
    const dxf = patternToDxf(patterns);
    const totalHoles = patterns.reduce((a, p) => a + p.holes.length, 0);
    expect((svg.match(/<circle /g) ?? []).length).toBe(totalHoles);
    expect((dxf.match(/\nCIRCLE\n/g) ?? []).length).toBe(totalHoles);
  });

  it('removes the holes when the feature is disabled', () => {
    const off = { ...cfg, tipFeature: { ...cfg.tipFeature, enabled: false } };
    const noHoles = buildLaserPatterns(off, res, true);
    expect(noHoles.every((p) => p.holes.length === 0)).toBe(true);
    expect(noHoles.every((p) => p.length === p.activeEnd)).toBe(true);
  });
});
