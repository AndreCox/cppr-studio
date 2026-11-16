import { describe, expect, it } from 'vitest';
import { cutParamRange, loopArea, sectionLoops, sectionProps, sectionTable } from '../src/core/geometry/section';

const close = (a: number, b: number, rel = 1e-6, abs = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(abs, Math.abs(b) * rel));

describe('notched tube cross-section (chord cut)', () => {
  const tube = { od: 4.02, id: 3.7 };

  it('reduces to the full annulus for g = 0', () => {
    const p = sectionProps(tube, 'chord', 0);
    const R = tube.od / 2;
    const a = tube.id / 2;
    close(p.area, Math.PI * (R * R - a * a));
    close(p.Iyy, (Math.PI / 4) * (R ** 4 - a ** 4));
    close(p.gamma, 0, 1, 1e-9);
    close(p.xMax, R);
    close(p.remainingWidth, 2 * R);
  });

  it('reproduces the paper Fig. 5 deep-notch neutral-axis values', () => {
    const t = { od: 3, id: 2.8 };
    // Read off the model curve (h* = 1.5, c* = 0.5) of Fig. 5
    const approx: Record<string, number> = { '0.7': 0.37, '0.8': 0.42, '0.9': 0.46 };
    for (const [gStar, gamStar] of Object.entries(approx)) {
      const p = sectionProps(t, 'chord', parseFloat(gStar) * t.od);
      expect(p.gamma / t.od).toBeGreaterThan(gamStar - 0.025);
      expect(p.gamma / t.od).toBeLessThan(gamStar + 0.025);
    }
  });

  it('matches the analytic centroid of a half-annulus (g = OD/2)', () => {
    const R = tube.od / 2;
    const a = tube.id / 2;
    const p = sectionProps(tube, 'chord', R);
    const xbar = (-4 * (R ** 3 - a ** 3)) / (3 * Math.PI * (R ** 2 - a ** 2));
    expect(p.xbar).toBeCloseTo(xbar, 6);
  });

  it('produces a closed C-shaped boundary for a deep notch', () => {
    const loops = sectionLoops(tube, 'chord', 3.63, 60);
    expect(loops).toHaveLength(1);
    const area = Math.abs(loopArea(loops[0].points));
    const p = sectionProps(tube, 'chord', 3.63);
    expect(area / p.area).toBeGreaterThan(0.98);
    expect(area / p.area).toBeLessThan(1.02);
  });

  it('keeps an inner hole for a shallow notch', () => {
    const loops = sectionLoops(tube, 'chord', 0.1, 60);
    expect(loops).toHaveLength(2);
    expect(loops[1].hole).toBe(true);
    const outer = Math.abs(loopArea(loops[0].points));
    const hole = Math.abs(loopArea(loops[1].points));
    const p = sectionProps(tube, 'chord', 0.1);
    expect((outer - hole) / p.area).toBeGreaterThan(0.97);
    expect((outer - hole) / p.area).toBeLessThan(1.03);
  });

  it('enforces the minimum backbone width', () => {
    const { gMax } = cutParamRange(tube, 'chord', 0.4, 0.95);
    const p = sectionProps(tube, 'chord', gMax);
    expect(p.remainingWidth).toBeGreaterThanOrEqual(0.399);
  });
});

describe('radial cut', () => {
  const tube = { od: 4.02, id: 3.7 };

  it('reduces to the full annulus at g = 0', () => {
    const p = sectionProps(tube, 'radial', 0);
    close(p.area, Math.PI * (4.02 ** 2 - 3.7 ** 2) / 4);
    close(p.gamma, 0, 1, 1e-9);
  });

  it('matches the closed-form annular sector centroid', () => {
    const R = tube.od / 2;
    const a = tube.id / 2;
    const theta = 1.1;
    const p = sectionProps(tube, 'radial', theta * R);
    // centroid x of annulus sector [θ, 2π−θ]
    const xbar =
      (-2 * Math.sin(theta) * (R ** 3 - a ** 3)) / (3 * (Math.PI - theta) * (R ** 2 - a ** 2));
    close(p.xbar, xbar, 1e-9);
    close(p.area, (Math.PI - theta) * (R * R - a * a), 1e-9);
  });

  it('gives the expected remaining width', () => {
    const R = tube.od / 2;
    const p = sectionProps(tube, 'radial', 0.9 * tube.od);
    const theta = (0.9 * tube.od) / R;
    close(p.remainingWidth, (R + tube.id / 2) * (Math.PI - theta));
  });
});

describe('section table', () => {
  const tube = { od: 4.02, id: 3.7 };

  it('inverts I(g)', () => {
    const table = sectionTable(tube, 'chord');
    for (const g of [0.2, 1.0, 2.5, 3.63]) {
      const I = sectionProps(tube, 'chord', g).Iyy;
      const back = table.gForI(I);
      expect(back).not.toBeNull();
      expect(Math.abs((back as number) - g)).toBeLessThan(0.01);
    }
  });

  it('is monotone in gamma and I', () => {
    const table = sectionTable(tube, 'chord');
    let lastG = 0;
    let lastI = Infinity;
    for (let i = 1; i <= 80; i++) {
      const g = (i / 80) * table.gPhysMax * 0.9;
      const p = table.at(g);
      expect(p.gamma).toBeGreaterThanOrEqual(lastG - 1e-6);
      expect(p.Iyy).toBeLessThanOrEqual(lastI + 1e-6);
      lastG = p.gamma;
      lastI = p.Iyy;
    }
  });
});

describe('validation against paper Table I', () => {
  // Nitinol S-shape prototype: OD_o 4.02 / t 0.16, OD_i 3.50 / t 0.15,
  // c = 3.27 mm, 10 notches.  Table I lists h, g_o, g_i.
  const outer = { od: 4.02, id: 3.7 };
  const inner = { od: 3.5, id: 3.2 };
  const rows = [
    [2.17, 3.63, 3.09], [2.28, 3.7, 3.16], [2.24, 3.68, 3.14], [2.2, 3.65, 3.12],
    [2.11, 3.55, 3.01], [2.04, 3.32, 2.77], [2.16, 3.62, 3.09], [2.24, 3.68, 3.14],
    [2.22, 3.66, 3.13], [2.35, 3.72, 3.18],
  ];
  it('has near-equal EI in the two notched sections (design constraint 20)', () => {
    for (const [, go, gi] of rows) {
      const po = sectionProps(outer, 'chord', go);
      const pi = sectionProps(inner, 'chord', gi);
      const ratio = po.Iyy / pi.Iyy;
      expect(ratio).toBeGreaterThan(0.91);
      expect(ratio).toBeLessThan(1.08);
    }
  });

  it('yields a constant curved-segment length l_j for a plausible benchmark curvature', () => {
    // The implied l_j = h_j / (1 + gamma_o * kappa_j) must be constant along the
    // tube.  Using the design relation kappa_j / alpha_j = const, the minimum
    // coefficient of variation occurs at the benchmark curvature used to build
    // the prototype.  This confirms the gamma/I definitions used by the paper.
    const info = rows.map(([h, go, gi]) => {
      const po = sectionProps(outer, 'chord', go);
      const pi = sectionProps(inner, 'chord', gi);
      const d = po.gamma + pi.gamma;
      const EI = 60000 * (po.Iyy + pi.Iyy);
      return { h, gamma: po.gamma, alpha: d / EI };
    });
    const m = info[1];
    let best = { cv: Infinity, km: 0, mean: 0 };
    for (let km = 0.02; km <= 0.25; km += 0.002) {
      const ls = info.map((r) => r.h / (1 + r.gamma * km * (r.alpha / m.alpha)));
      const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
      const sd = Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / ls.length);
      const cv = sd / mean;
      if (cv < best.cv) best = { cv, km, mean };
    }
    expect(best.cv).toBeLessThan(0.02);
    expect(best.km).toBeGreaterThan(0.05);
    expect(best.km).toBeLessThan(0.14);
    expect(best.mean).toBeGreaterThan(1.8);
    expect(best.mean).toBeLessThan(2.15);
  });
});
