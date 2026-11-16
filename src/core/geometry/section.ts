import type { CutType } from '../types';

export interface TubeGeometry {
  od: number;
  id: number;
}

export interface SectionProps {
  /** Cut parameter used to generate the section, mm */
  g: number;
  /** Half-angle of the removed sector for radial cuts (rad); angle to the cut corner at the outer surface for chord cuts */
  theta: number;
  area: number;
  /** Centroid x coordinate in the local notch frame (material lies on −x), mm */
  xbar: number;
  /** Neutral-axis offset magnitude, mm (≥ 0) */
  gamma: number;
  /** Second moment about the centroidal y axis (bending axis), mm^4 */
  Iyy: number;
  /** Second moment about the centroidal x axis, mm^4 */
  Ixx: number;
  /** Polar second moment about the centroid, mm^4 */
  J: number;
  /** Extreme x on the cut side, mm */
  xMax: number;
  /** Extreme x on the backbone side, mm (−R) */
  xMin: number;
  /** A characteristic remaining material width, mm */
  remainingWidth: number;
  /** Fraction of the solid tube cross-section area that remains */
  fillRatio: number;
  R: number;
  a: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Composite Simpson integration. */
function simpson(f: (x: number) => number, a: number, b: number, n = 160): number {
  if (!(b > a)) return 0;
  const m = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / m;
  let sum = f(a) + f(b);
  for (let i = 1; i < m; i++) sum += f(a + i * h) * (i % 2 === 1 ? 4 : 2);
  return (sum * h) / 3;
}

/** Integrate over [a,b], splitting at r0 to keep the integrand smooth. */
function simpsonSplit(
  f: (x: number) => number,
  a: number,
  b: number,
  r0: number | null,
  n = 160,
): number {
  if (!(b > a)) return 0;
  if (r0 !== null && r0 > a + 1e-9 && r0 < b - 1e-9) {
    return simpson(f, a, r0, n / 2) + simpson(f, r0, b, n / 2);
  }
  return simpson(f, a, b, n);
}

/**
 * Cross-section of a tube with a notch cut into its +x side.
 *
 * chord:  the notch floor is the plane x = R − g (milling / printing).
 * radial: the notch is a wedge of half-angle theta = g/R (laser cut from the
 *         side, producing radially aligned cut faces).
 */
export function sectionProps(tube: TubeGeometry, cutType: CutType, gRaw: number): SectionProps {
  const R = tube.od / 2;
  const a = Math.max(0, tube.id / 2);
  const solidArea = Math.PI * (R * R - a * a);
  const g = Math.max(0, Math.min(gRaw, cutType === 'chord' ? 2 * R : Math.PI * R));
  if (solidArea <= 0 || R <= 0) {
    return {
      g, theta: 0, area: 0, xbar: -R, gamma: R, Iyy: 0, Ixx: 0, J: 0,
      xMax: -R, xMin: -R, remainingWidth: 0, fillRatio: 0, R, a,
    };
  }

  let thetaOf: (r: number) => number;
  let split: number | null = null;
  let xMax: number;
  if (cutType === 'chord') {
    const c = R - g;
    xMax = c;
    thetaOf = (r) => Math.acos(clamp(c / r, -1, 1));
    split = Math.abs(c);
  } else {
    const theta = clamp(g / R, 0, Math.PI);
    xMax = R * Math.cos(theta);
    thetaOf = () => theta;
    split = null;
  }

  let area = 0;
  let My = 0;
  let Iyy = 0;
  let Ixx = 0;
  const simpsonN = cutType === 'chord' ? 120 : 80;

  area = simpsonSplit((r) => 2 * (Math.PI - thetaOf(r)) * r, a, R, split, simpsonN);
  My = simpsonSplit((r) => -2 * r * r * Math.sin(thetaOf(r)), a, R, split, simpsonN);
  Iyy = simpsonSplit(
    (r) => r * r * r * (Math.PI - thetaOf(r) - Math.sin(2 * thetaOf(r)) / 2),
    a, R, split, simpsonN,
  );
  Ixx = simpsonSplit(
    (r) => r * r * r * (Math.PI - thetaOf(r) + Math.sin(2 * thetaOf(r)) / 2),
    a, R, split, simpsonN,
  );

  const xbar = area > 1e-12 ? My / area : -R;
  const IyyC = Math.max(0, Iyy - area * xbar * xbar);
  const IxxC = Math.max(0, Ixx);
  const remainingWidth =
    cutType === 'chord'
      ? Math.max(0, 2 * R - g)
      : Math.max(0, (R + a) * (Math.PI - clamp(g / R, 0, Math.PI)));

  return {
    g,
    theta: thetaOf(R),
    area,
    xbar,
    gamma: Math.max(0, -xbar),
    Iyy: IyyC,
    Ixx: IxxC,
    J: IxxC + IyyC,
    xMax,
    xMin: -R,
    remainingWidth,
    fillRatio: solidArea > 0 ? area / solidArea : 0,
    R,
    a,
  };
}

/** Strains at the backbone edge and the cut edge for a tube curvature. */
export function edgeStrains(sec: SectionProps, kappaTube: number): { back: number; cut: number } {
  const k = Math.abs(kappaTube);
  return {
    back: k * (sec.R - sec.gamma),
    cut: k * (sec.xMax - sec.xbar),
  };
}

/* ------------------------------------------------------------------ */
/* Monotone cubic interpolation                                        */
/* ------------------------------------------------------------------ */

export class MonoCurve {
  private xs: number[];
  private ys: number[];
  private ms: number[];

  constructor(xs: number[], ys: number[]) {
    this.xs = xs;
    this.ys = ys;
    const n = xs.length;
    const d: number[] = new Array(Math.max(0, n - 1));
    for (let i = 0; i < n - 1; i++) {
      d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-12);
    }
    const m: number[] = new Array(n);
    m[0] = d[0] ?? 0;
    m[n - 1] = d[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
        const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    this.ms = m;
  }

  eval(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (n === 0) return 0;
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.ys[lo] +
      (t3 - 2 * t2 + t) * h * this.ms[lo] +
      (-2 * t3 + 3 * t2) * this.ys[hi] +
      (t3 - t2) * h * this.ms[hi]
    );
  }
}

/* ------------------------------------------------------------------ */
/* Tabulated section properties                                        */
/* ------------------------------------------------------------------ */

export class SectionTable {
  readonly tube: TubeGeometry;
  readonly cutType: CutType;
  readonly gPhysMax: number;
  private gs: number[] = [];
  private areaC!: MonoCurve;
  private gammaC!: MonoCurve;
  private iyyC!: MonoCurve;
  private ixxC!: MonoCurve;
  private jC!: MonoCurve;
  private xMaxC!: MonoCurve;
  private widthC!: MonoCurve;
  private thetaC!: MonoCurve;
  readonly samples: SectionProps[] = [];

  constructor(tube: TubeGeometry, cutType: CutType, nSamples = 721) {
    this.tube = tube;
    this.cutType = cutType;
    const R = tube.od / 2;
    this.gPhysMax = cutType === 'chord' ? 2 * R : Math.PI * R;
    const n = Math.max(64, nSamples);
    const gTop = this.gPhysMax * 0.9995;
    for (let i = 0; i < n; i++) {
      const g = (gTop * i) / (n - 1);
      const p = sectionProps(tube, cutType, g);
      this.gs.push(g);
      this.samples.push(p);
    }
    this.areaC = new MonoCurve(this.gs, this.samples.map((p) => p.area));
    this.gammaC = new MonoCurve(this.gs, this.samples.map((p) => p.gamma));
    this.iyyC = new MonoCurve(this.gs, this.samples.map((p) => p.Iyy));
    this.ixxC = new MonoCurve(this.gs, this.samples.map((p) => p.Ixx));
    this.jC = new MonoCurve(this.gs, this.samples.map((p) => p.J));
    this.xMaxC = new MonoCurve(this.gs, this.samples.map((p) => p.xMax));
    this.widthC = new MonoCurve(this.gs, this.samples.map((p) => p.remainingWidth));
    this.thetaC = new MonoCurve(this.gs, this.samples.map((p) => p.theta));
  }

  at(g: number): SectionProps {
    const gCl = Math.max(0, Math.min(g, this.gPhysMax * 0.9995));
    const R = this.tube.od / 2;
    const a = Math.max(0, this.tube.id / 2);
    const pseudo: SectionProps = {
      g: gCl,
      theta: this.thetaC.eval(gCl),
      area: this.areaC.eval(gCl),
      xbar: -this.gammaC.eval(gCl),
      gamma: this.gammaC.eval(gCl),
      Iyy: Math.max(0, this.iyyC.eval(gCl)),
      Ixx: Math.max(0, this.ixxC.eval(gCl)),
      J: Math.max(0, this.jC.eval(gCl)),
      xMax: this.xMaxC.eval(gCl),
      xMin: -R,
      remainingWidth: this.widthC.eval(gCl),
      fillRatio: 0,
      R,
      a,
    };
    pseudo.fillRatio = Math.PI * (R * R - a * a) > 0
      ? pseudo.area / (Math.PI * (R * R - a * a))
      : 0;
    return pseudo;
  }

  /** Smallest g achieving the requested second moment Iyy (I decreases with g). */
  gForI(targetI: number): number | null {
    if (!(targetI > 0)) return null;
    const iTop = this.samples[0].Iyy;
    const iBot = this.samples[this.samples.length - 1].Iyy;
    if (targetI > iTop * 1.0001 || targetI < iBot * 0.9999) return null;
    let lo = 0;
    let hi = this.gs[this.gs.length - 1];
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.iyyC.eval(mid) > targetI) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Largest g whose remaining material width is at least the requested width. */
  gForMinWidth(minWidth: number): number {
    if (minWidth <= 0) return this.gPhysMax;
    let lo = 0;
    let hi = this.gs[this.gs.length - 1];
    if (this.widthC.eval(hi) > minWidth) return hi;
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.widthC.eval(mid) > minWidth) lo = mid;
      else hi = mid;
    }
    return lo;
  }
}

const tableCache = new Map<string, SectionTable>();
const keyOf = (t: TubeGeometry, c: CutType) => `${t.od.toFixed(4)}|${t.id.toFixed(4)}|${c}`;

export function sectionTable(tube: TubeGeometry, cutType: CutType): SectionTable {
  const key = keyOf(tube, cutType);
  let t = tableCache.get(key);
  if (!t) {
    t = new SectionTable(tube, cutType);
    tableCache.set(key, t);
    if (tableCache.size > 64) {
      const first = tableCache.keys().next().value;
      if (first) tableCache.delete(first);
    }
  }
  return t;
}

/** Convenience: SectionProps from the table (interpolated). */
export function sectionAt(tube: TubeGeometry, cutType: CutType, g: number): SectionProps {
  return sectionTable(tube, cutType).at(g);
}

/* ------------------------------------------------------------------ */
/* Boundary polygons for drawings and meshes                           */
/* ------------------------------------------------------------------ */

export interface Loop {
  points: { x: number; y: number }[];
  hole: boolean;
}

/** Build the 2D cross-section boundary in the local notch frame (material on −x). */
export function sectionLoops(tube: TubeGeometry, cutType: CutType, gRaw: number, arcSteps = 180): Loop[] {
  const R = tube.od / 2;
  const a = Math.max(0, tube.id / 2);
  const g = Math.max(0, Math.min(gRaw, cutType === 'chord' ? 2 * R : Math.PI * R));

  const arc = (
    radius: number,
    t0: number,
    t1: number,
    n: number,
  ): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      pts.push({ x: radius * Math.cos(t), y: radius * Math.sin(t) });
    }
    return pts;
  };

  if (g <= 1e-9) {
    return [
      { points: arc(R, 0, 2 * Math.PI, 4 * arcSteps).slice(0, -1), hole: false },
      { points: arc(a, 0, 2 * Math.PI, 2 * arcSteps).slice(0, -1), hole: true },
    ];
  }

  if (cutType === 'radial') {
    const th = g / R;
    const outer = arc(R, th, 2 * Math.PI - th, arcSteps);
    const inner = arc(a, 2 * Math.PI - th, th, Math.max(12, Math.floor(arcSteps / 2)));
    return [{ points: [...outer, ...inner], hole: false }];
  }

  const c = R - g;
  if (c <= -R + 1e-9) return [];

  if (c >= a) {
    // Shallow notch: the inner wall is intact. Region = annulus minus a bite.
    const th = Math.acos(clamp(c / R, -1, 1));
    const outer = arc(R, th, 2 * Math.PI - th, arcSteps);
    // The outer arc runs from (c, +Y) around the back to (c, −Y); the implicit
    // closing chord completes the region.  The inner wall is an intact hole.
    const inner = arc(a, 0, 2 * Math.PI, 2 * arcSteps).slice(0, -1);
    return [
      { points: outer, hole: false },
      { points: inner, hole: true },
    ];
  }

  // Deep notch: C-shaped section, notch breaks through the inner wall.
  const thR = Math.acos(clamp(c / R, -1, 1));
  const thA = Math.acos(clamp(c / a, -1, 1));
  const Yr = Math.sqrt(Math.max(0, R * R - c * c));
  const Ya = Math.sqrt(Math.max(0, a * a - c * c));
  const outer = arc(R, thR, 2 * Math.PI - thR, arcSteps);
  const inner = arc(a, 2 * Math.PI - thA, thA, Math.max(24, Math.floor(arcSteps / 2)));
  // outer: upper cut corner -> around the back -> lower cut corner
  // then up the cut face to the inner lower corner, inner arc back (clockwise),
  // up the inner cut face and close.
  const points = [...outer, { x: c, y: -Ya }, ...inner];
  void Yr;
  void Ya;
  return [{ points, hole: false }];
}

/** Signed area of a loop (positive = CCW). */
export function loopArea(points: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/**
 * Depth cap for a cut profile.  Chord depths are a fraction of the OD; radial
 * depths are an arc length around the outer circumference, so the same fraction
 * refers to the half-circumference (πR).
 */
export function cutParamCap(tube: TubeGeometry, cutType: CutType, maxDepthFrac: number): number {
  const R = tube.od / 2;
  return maxDepthFrac * (cutType === 'chord' ? tube.od : Math.PI * R);
}

export function cutParamRange(
  tube: TubeGeometry,
  cutType: CutType,
  minBackbone: number,
  maxDepthFrac: number,
): { gMax: number; gHardMax: number } {
  const table = sectionTable(tube, cutType);
  const gForWidth = table.gForMinWidth(Math.max(0, minBackbone));
  const gForFrac = cutParamCap(tube, cutType, maxDepthFrac);
  return {
    gMax: Math.min(gForWidth, gForFrac, table.gPhysMax),
    gHardMax: Math.min(gForFrac, table.gPhysMax),
  };
}
