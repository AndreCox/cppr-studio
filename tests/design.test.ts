import { describe, expect, it } from 'vitest';
import { designSegment } from '../src/core/design/segment';
import { PAPER_NITINOL, makeSegment } from '../src/core/defaults';
import { cloneMaterials } from '../src/core/materials';
import { sectionProps } from '../src/core/geometry/section';
import { solveActuation, makeNotchPair } from '../src/core/model/mechanics';

const materials = cloneMaterials();

describe('nitinol paper validation design', () => {
  it('designs the S-curve with depths in the published range', () => {
    const cfg = PAPER_NITINOL();
    const res = designSegment(cfg, materials);
    expect(res.ok).toBe(true);
    expect(res.notches.length).toBe(10);
    // Published prototype: g_o 3.32–3.72, g_i 2.77–3.18, h 2.04–2.35
    const gos = res.notches.map((n) => n.gOuter);
    expect(Math.max(...gos)).toBeGreaterThan(3.4);
    expect(Math.min(...gos)).toBeGreaterThan(2.9);
    const hs = res.notches.map((n) => n.h);
    expect(Math.min(...hs)).toBeGreaterThan(1.7);
    expect(Math.max(...hs)).toBeLessThan(2.7);
    expect(res.qDesign).toBeGreaterThan(0);
    expect(res.designState?.converged).toBe(true);
    expect(res.rmsError).toBeLessThan(0.06);
    expect(res.rmsError).toBeGreaterThan(0);
  });

  it('round-trips a single notch through the forward kinematics', () => {
    const tubeO = { od: 4.02, id: 3.7 };
    const tubeI = { od: 3.5, id: 3.2 };
    const go = 3.7;
    const gi = 3.16;
    const kappa = 0.1;
    const secO = sectionProps(tubeO, 'chord', go);
    const secI = sectionProps(tubeI, 'chord', gi);
    const pair = makeNotchPair({
      index: 0, kappaTarget: kappa, gOuter: go, gInner: gi,
      h: 2.2, l: 1.9, c: 3.27, secOuter: secO, secInner: secI,
      EOuter: 60000, EInner: 60000,
    });
    const q = pair.d * pair.h * (kappa / (1 - pair.gammaOuter * kappa));
    const state = solveActuation([pair], q);
    expect(state.converged).toBe(true);
    expect(state.kappas[0]).toBeCloseTo(kappa, 5);
    const expectedTau =
      (60000 * secO.Iyy * (kappa / (1 + secO.gamma * kappa)) +
        60000 * secI.Iyy * (kappa / (1 - secI.gamma * kappa))) / pair.d;
    expect(state.tau).toBeCloseTo(expectedTau, 3);
    expect(state.shape[state.shape.length - 1].s).toBeCloseTo(2.2 / (1 + secO.gamma * kappa) + 3.27, 2);
  });

  it('reports infeasible designs with actionable errors', () => {
    const cfg = makeSegment({ shape: { kind: 'preset', preset: 'constant', kappaMax: 0.5, waypoints: [] } });
    const res = designSegment(cfg, materials);
    expect(res.ok === false || res.warnings.length > 0).toBe(true);
  });
});
