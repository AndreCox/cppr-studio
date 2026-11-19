import { compileDesiredCurve, distanceToPolyline, type DesiredCurve } from '../geometry/curve';
import {
  cutParamCap,
  sectionProps,
  sectionTable,
  type SectionProps,
  type TubeGeometry,
} from '../geometry/section';
import {
  actuationForKappas,
  buildShape,
  kappaInnerOf,
  kappaOuterOf,
  makeNotchPair,
  notchStrains,
  solveActuation,
  sweepActuation,
  tensionAt,
  type NotchPair,
} from '../model/mechanics';
import { findMaterial } from '../materials';
import { transmissionDesign } from '../fab/transmission';
import type {
  Material,
  NotchResult,
  SegmentConfig,
  SegmentResult,
} from '../types';

interface Ctx {
  cfg: SegmentConfig;
  outer: TubeGeometry;
  inner: TubeGeometry;
  tableO: ReturnType<typeof sectionTable>;
  tableI: ReturnType<typeof sectionTable>;
  EO: number;
  EI: number;
  allowO: number;
  allowI: number;
  gMaxO: number;
  gMaxI: number;
  kappaClamp: number;
}

interface PairEval {
  gOuter: number;
  gInner: number;
  secOuter: SectionProps;
  secInner: SectionProps;
  d: number;
  EIOuter: number;
  EIInner: number;
  alpha: number;
  util: number;
  strainMax: number;
  kappaOuter: number;
  kappaInner: number;
  gInnerCapped: boolean;
  gOuterCapped: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function bisect(f: (x: number) => number, lo: number, hi: number, iters = 55): number {
  let a = lo;
  let b = hi;
  let fa = f(a);
  for (let i = 0; i < iters; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if (fm === 0 || Math.abs(b - a) < 1e-12) return m;
    if (fa * fm <= 0) {
      b = m;
    } else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}

function evalPair(ctx: Ctx, gOuter: number, kappaAbs: number): PairEval {
  const secOuter = ctx.tableO.at(gOuter);
  const targetI = (ctx.EO / ctx.EI) * secOuter.Iyy;
  const gRaw = ctx.tableI.gForI(targetI);
  let gInner: number;
  let gInnerCapped = false;
  if (gRaw === null) {
    gInner = targetI > ctx.tableI.at(0).Iyy ? 0 : ctx.gMaxI;
    gInnerCapped = true;
  } else {
    gInner = clamp(gRaw, 0, ctx.gMaxI);
    gInnerCapped = gRaw > ctx.gMaxI + 1e-9 || gRaw < -1e-9;
  }
  const secInner = ctx.tableI.at(gInner);
  const d = secOuter.gamma + secInner.gamma;
  const EIOuter = ctx.EO * secOuter.Iyy;
  const EIInner = ctx.EI * secInner.Iyy;
  const alpha = d / Math.max(1e-12, EIOuter + EIInner);
  const kappaOuter = kappaAbs / (1 + secOuter.gamma * kappaAbs);
  const kappaInner = kappaAbs / (1 - secInner.gamma * kappaAbs);
  const eOB = Math.abs(kappaOuter) * (secOuter.R - secOuter.gamma);
  const eOC = Math.abs(kappaOuter) * (secOuter.xMax - secOuter.xbar);
  const eIB = Math.abs(kappaInner) * (secInner.R - secInner.gamma);
  const eIC = Math.abs(kappaInner) * (secInner.xMax - secInner.xbar);
  const util = Math.max(
    eOB / ctx.allowO,
    eOC / ctx.allowO,
    eIB / ctx.allowI,
    eIC / ctx.allowI,
  );
  return {
    gOuter,
    gInner,
    secOuter,
    secInner,
    d,
    EIOuter,
    EIInner,
    alpha,
    util,
    strainMax: Math.max(eOB, eOC, eIB, eIC),
    kappaOuter,
    kappaInner,
    gInnerCapped,
    gOuterCapped: gOuter >= ctx.gMaxO - 1e-9,
  };
}

interface Benchmark {
  pair: PairEval;
  alpha: number;
  kappa: number;
  strainLimited: boolean;
  feasible: boolean;
  maxUtil: number;
}

function solveBenchmark(ctx: Ctx, kappaAbs: number): Benchmark {
  const minG = Math.min(0.02 * ctx.outer.od, ctx.gMaxO);
  if (!(kappaAbs > 1e-9)) {
    const pair = evalPair(ctx, 0, 0);
    return { pair, alpha: 0, kappa: 0, strainLimited: false, feasible: true, maxUtil: 0 };
  }
  const u0 = evalPair(ctx, 0, kappaAbs).util;
  const uTopPair = evalPair(ctx, ctx.gMaxO, kappaAbs);
  if (uTopPair.util > 1 + 1e-6) {
    return {
      pair: uTopPair, alpha: uTopPair.alpha, kappa: kappaAbs,
      strainLimited: true, feasible: false, maxUtil: uTopPair.util,
    };
  }
  if (u0 <= 1) {
    // The curvature is gentle enough that a solid tube meets the strain limit.
    // Use a minimum-depth hinge to keep the pair actuable without a degenerate
    // (zero-compliance, infinite-force) design.
    const pair = evalPair(ctx, minG, kappaAbs);
    return {
      pair, alpha: pair.alpha, kappa: kappaAbs,
      strainLimited: false, feasible: true, maxUtil: pair.util,
    };
  }
  const g = bisect(
    (x) => evalPair(ctx, x, kappaAbs).util - 1,
    0,
    ctx.gMaxO,
  );
  const pair = evalPair(ctx, g, kappaAbs);
  return {
    pair, alpha: pair.alpha, kappa: kappaAbs,
    strainLimited: true, feasible: true, maxUtil: pair.util,
  };
}

/** Largest centreline curvature the pair can reach within the strain/depth limits. */
function computeCapacity(ctx: Ctx): { kappa: number; limitedBy: 'strain' | 'contact' } {
  const kContact = ctx.kappaClamp;
  const uAtContact = evalPair(ctx, ctx.gMaxO, kContact).util;
  if (uAtContact <= 1) return { kappa: kContact, limitedBy: 'contact' };
  let lo = 1e-5;
  let hi = kContact;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const u = evalPair(ctx, ctx.gMaxO, mid).util;
    if (u > 1) hi = mid;
    else lo = mid;
  }
  return { kappa: 0.5 * (lo + hi), limitedBy: 'strain' };
}

/** Sequential normal-error fit used by the paper to convert a curve into curvatures. */
function sequentialKappas(
  curve: DesiredCurve,
  n: number,
  L: number,
  l: number,
  c: number,
): number[] {
  const out: number[] = [];
  let pose = { x: 0, z: 0, psi: 0 };
  const kRef = Math.max(curve.maxKappa * 2.2, 0.01);
  const advance = (kappa: number) => {
    const p = { ...pose };
    if (Math.abs(kappa) > 1e-10) {
      const dpsi = kappa * l;
      p.x += (Math.cos(pose.psi) - Math.cos(pose.psi + dpsi)) / kappa;
      p.z += (Math.sin(pose.psi + dpsi) - Math.sin(pose.psi)) / kappa;
      p.psi += dpsi;
    } else {
      p.x += l * Math.sin(pose.psi);
      p.z += l * Math.cos(pose.psi);
    }
    p.x += c * Math.sin(p.psi);
    p.z += c * Math.cos(p.psi);
    return p;
  };
  for (let j = 0; j < n; j++) {
    const sNext = (L * (j + 1)) / n;
    const desired = curve.poseAt(sNext);
    const nx = Math.cos(desired.psi);
    const nz = -Math.sin(desired.psi);
    const err = (kappa: number) => {
      const p = advance(kappa);
      return nx * (p.x - desired.x) + nz * (p.z - desired.z);
    };
    const s0 = (L * j) / n;
    let segTurn = desired.psi - curve.poseAt(s0).psi;
    while (segTurn > Math.PI) segTurn -= 2 * Math.PI;
    while (segTurn < -Math.PI) segTurn += 2 * Math.PI;
    const natural = l > 1e-9 ? segTurn / l : 0;
    let bestK = natural;
    let found = false;
    const N = 81;
    let prevK = -kRef;
    let prevE = err(prevK);
    let bestDist = Infinity;
    for (let i = 1; i <= N; i++) {
      const k = -kRef + ((2 * kRef) * i) / N;
      const e = err(k);
      if (prevE === 0 || prevE * e < 0) {
        const root = bisect(err, prevK, k, 45);
        const dist = Math.abs(root - natural);
        if (dist < bestDist) {
          bestDist = dist;
          bestK = root;
          found = true;
        }
      }
      prevK = k;
      prevE = e;
    }
    if (!found) bestK = natural;
    out.push(bestK);
    pose = advance(bestK);
  }
  return out;
}

export function designSegment(cfg: SegmentConfig, materials: Material[]): SegmentResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const empty: SegmentResult = {
    segmentId: cfg.id, ok: false, errors, warnings, info,
    desiredShape: [], desiredKappa: [], notches: [], designState: null, sweep: [],
    qDesign: 0, tauDesign: 0, rmsError: 0, tipError: 0, activeTubeLength: 0,
    kappaCapacity: null, mass: 0, clearance: 0, innerId: 0, outerId: 0, notchTable: [],
  };

  const matO = findMaterial(materials, cfg.outerTube.materialId);
  const matI = findMaterial(materials, cfg.innerTube.materialId);
  const outer: TubeGeometry = {
    od: cfg.outerTube.od,
    id: cfg.outerTube.od - 2 * cfg.outerTube.wall,
  };
  const inner: TubeGeometry = {
    od: cfg.innerTube.od,
    id: cfg.innerTube.od - 2 * cfg.innerTube.wall,
  };
  empty.clearance = (outer.id - inner.od) / 2;
  empty.innerId = inner.id;
  empty.outerId = outer.id;

  if (!(cfg.activeLength > 0)) errors.push('Active length must be positive.');
  if (!(cfg.notches >= 1)) errors.push('At least one notch is required.');
  if (!(cfg.beta > 0 && cfg.beta < 1)) errors.push('β must be between 0 and 1.');
  if (outer.id <= 0) errors.push('Outer tube wall is thicker than its radius.');
  if (inner.id <= 0) errors.push('Inner tube wall is thicker than its radius.');
  if (inner.od >= outer.id) errors.push('Inner tube does not fit inside the outer tube.');
  if (cfg.safetyFactor < 1) errors.push('Safety factor must be ≥ 1.');
  if (errors.length > 0) return empty;

  const clearance = (outer.id - inner.od) / 2;
  if (clearance < cfg.minClearance - 5e-4) {
    warnings.push(
      `Radial clearance ${clearance.toFixed(3)} mm is below the ${cfg.minClearance.toFixed(3)} mm minimum.`,
    );
  }
  if (clearance <= 0.001) errors.push('Inner and outer tubes interfere (zero clearance).');

  const allowO = (cfg.strainLimitOverride ?? matO.strainLimit) / cfg.safetyFactor;
  const allowI = (cfg.strainLimitOverride ?? matI.strainLimit) / cfg.safetyFactor;
  const tableO = sectionTable(outer, cfg.cutType);
  const tableI = sectionTable(inner, cfg.cutType);
  const gMaxO = Math.min(
    tableO.gForMinWidth(Math.max(0, cfg.minBackbone)),
    cutParamCap(outer, cfg.cutType, cfg.maxDepthFrac),
    tableO.gPhysMax * 0.995,
  );
  const gMaxI = Math.min(
    tableI.gForMinWidth(Math.max(0, cfg.minBackbone)),
    cutParamCap(inner, cfg.cutType, cfg.maxDepthFrac),
    tableI.gPhysMax * 0.995,
  );
  const ctx: Ctx = {
    cfg, outer, inner, tableO, tableI,
    EO: matO.E, EI: matI.E,
    allowO, allowI,
    gMaxO, gMaxI,
    kappaClamp: (0.97 * 2) / outer.od,
  };

  const curve = compileDesiredCurve(cfg.shape, cfg.activeLength);
  const L = cfg.activeLength;
  const n = Math.round(cfg.notches);
  const l = (L * (1 - cfg.beta)) / n;
  const c = (L * cfg.beta) / n;

  const desiredKappa: { s: number; kappa: number }[] = [];
  for (let i = 0; i <= 200; i++) {
    const s = (L * i) / 200;
    desiredKappa.push({ s, kappa: curve.kappaAt(s) });
  }

  let kappaTargets: number[];
  if (cfg.fitMode === 'sequential') {
    kappaTargets = sequentialKappas(curve, n, L, l, c);
  } else {
    // Turn-matching: the notch must supply the desired curve's tangent change
    // over its whole L/n segment, but it only bends over length l.  Sampling the
    // raw curve curvature would under-bend the robot by a factor of (1 − β).
    kappaTargets = [];
    for (let j = 0; j < n; j++) {
      const s0 = (L * j) / n;
      const s1 = (L * (j + 1)) / n;
      let turn = curve.poseAt(s1).psi - curve.poseAt(s0).psi;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      kappaTargets.push(turn / Math.max(1e-9, l));
    }
  }
  const kappaMaxDesired = kappaTargets.reduce((a, b) => Math.max(a, Math.abs(b)), 0);

  const capacity = computeCapacity(ctx);
  if (kappaMaxDesired > capacity.kappa * 1.02) {
    warnings.push(
      `Desired curvature ${(kappaMaxDesired * 1000).toFixed(1)} 1/m exceeds the achievable ` +
        `${(capacity.kappa * 1000).toFixed(1)} 1/m (min radius ${(1 / capacity.kappa).toFixed(1)} mm) ` +
        `for this tube pair and strain limit. Reduce the bend, use a thinner wall or a higher-strain material.`,
    );
  }

  const mIdx = kappaTargets.reduce(
    (best, k, i) => (Math.abs(k) > Math.abs(kappaTargets[best]) ? i : best),
    0,
  );
  const kappaM = Math.abs(kappaTargets[mIdx]);
  const benchmark = solveBenchmark(ctx, kappaM);
  if (!benchmark.feasible) {
    errors.push(
      `No valid notch depth: at the peak curvature ${(kappaM * 1000).toFixed(1)} 1/m the strain limit ` +
        `is exceeded even at the maximum allowed depth. Reduce the curvature or raise the strain limit.`,
    );
    return empty;
  }
  if (!benchmark.strainLimited) {
    info.push(
      'This shape is gentle: the strain limit is not the active constraint. Notch depths are set by ' +
        'the stiffness/force trade-off, and the actuation force may be higher than a strain-limited design.',
    );
  }
  const alphaM = benchmark.alpha;

  // Solve each notch for the compliance target alpha_j = alpha_m * kappa_j / kappa_m.
  const designs: {
    gO: number; gI: number; secO: SectionProps; secI: SectionProps;
    d: number; alpha: number; capped: boolean; EIUnmatched: boolean;
  }[] = [];
  for (let j = 0; j < n; j++) {
    const kAbs = Math.abs(kappaTargets[j]);
    if (!(kAbs > 1e-9) || !(alphaM > 0)) {
      const secO = tableO.at(0);
      const secI = tableI.at(0);
      designs.push({ gO: 0, gI: 0, secO, secI, d: 0, alpha: 0, capped: false, EIUnmatched: false });
      continue;
    }
    const targetAlpha = alphaM * (kAbs / kappaM);
    const aTop = evalPair(ctx, gMaxO, kAbs).alpha;
    let gO: number;
    let capped = false;
    if (targetAlpha >= aTop) {
      gO = gMaxO;
      capped = true;
    } else {
      gO = bisect((x) => evalPair(ctx, x, kAbs).alpha - targetAlpha, 0, gMaxO);
      if (Math.abs(gO - gMaxO) < 1e-6) capped = true;
    }
    const ev = evalPair(ctx, gO, kAbs);
    const EIUnmatched = Math.abs(ev.EIOuter - ev.EIInner) / Math.max(ev.EIOuter, ev.EIInner) > 0.06;
    designs.push({
      gO, gI: ev.gInner, secO: ev.secOuter, secI: ev.secInner,
      d: ev.d, alpha: ev.alpha, capped: capped || ev.gInnerCapped, EIUnmatched,
    });
  }

  // Build the notch pairs and the physical notch pattern.
  const notches: NotchPair[] = [];
  let z = 0;
  const notchResults: NotchResult[] = [];
  for (let j = 0; j < n; j++) {
    const dsn = designs[j];
    const kAbs = Math.abs(kappaTargets[j]);
    const h = l * (1 + dsn.secO.gamma * kAbs);
    const kappaSigned = kappaTargets[j];
    const pair = makeNotchPair({
      index: j,
      kappaTarget: kappaSigned,
      gOuter: dsn.gO,
      gInner: dsn.gI,
      h,
      l,
      c,
      secOuter: dsn.secO,
      secInner: dsn.secI,
      EOuter: ctx.EO,
      EInner: ctx.EI,
    });
    notches.push(pair);
    const kO = kappaOuterOf(pair, kappaSigned);
    const kI = kappaInnerOf(pair, kappaSigned);
    const st = notchStrains(pair, kappaSigned);
    const util = Math.max(
      st.outerBackbone / allowO, st.outerCut / allowO,
      st.innerBackbone / allowI, st.innerCut / allowI,
    );
    const tauEst = Math.abs(tensionAt(pair, kappaSigned));
    const hCrit = tauEst > 1e-9 ? Math.PI * Math.sqrt(pair.EIInner / tauEst) : Infinity;
    const notch: NotchResult = {
      index: j,
      zCenter: z + h / 2,
      h,
      l,
      c,
      gOuter: dsn.gO,
      gInner: dsn.gI,
      gammaOuter: dsn.secO.gamma,
      gammaInner: dsn.secI.gamma,
      IOuter: dsn.secO.Iyy,
      IInner: dsn.secI.Iyy,
      EIOuter: dsn.secO.Iyy * ctx.EO,
      EIInner: dsn.secI.Iyy * ctx.EI,
      phiOuter: kappaSigned < 0 ? 0 : Math.PI,
      phiInner: kappaSigned < 0 ? Math.PI : 0,
      kappaTarget: kappaSigned,
      kappaDesign: kappaSigned,
      kappaOuter: kO,
      kappaInner: kI,
      d: pair.d,
      alpha: pair.d / Math.max(1e-12, pair.EIOuter + pair.EIInner),
      strainOuterBackbone: st.outerBackbone,
      strainOuterCut: st.outerCut,
      strainInnerBackbone: st.innerBackbone,
      strainInnerCut: st.innerCut,
      strainMax: st.max,
      strainUtilisation: util,
      bucklingRatio: hCrit > 0 && Number.isFinite(hCrit) ? h / hCrit : Infinity,
      closureLimit: pair.kappaClamp,
      depthCapped: dsn.capped,
      EIUnmatched: dsn.EIUnmatched,
      warnings: [],
    };
    if (util > 1.001) {
      notch.warnings.push(
        `Strain ${(notch.strainMax * 100).toFixed(2)} % exceeds the allowable ` +
          `${(Math.min(allowO, allowI) * 100).toFixed(2)} %.`,
      );
      warnings.push(
        `Notch ${j + 1} exceeds the strain limit (${(notch.strainMax * 100).toFixed(2)} %).`,
      );
    }
    if (dsn.capped) {
      notch.warnings.push('Notch hit the maximum depth / minimum backbone limit; compliance target not met.');
      warnings.push(`Notch ${j + 1} is depth-capped.`);
    }
    if (dsn.EIUnmatched) {
      notch.warnings.push('Inner and outer notch flexural rigidities differ (EI constraint not met).');
    }
    if (notch.bucklingRatio > 1) {
      notch.warnings.push(
        `Notch length h = ${h.toFixed(2)} mm exceeds the Euler buckling length ` +
          `${(h / notch.bucklingRatio).toFixed(2)} mm at the design force.`,
      );
      warnings.push(`Notch ${j + 1} may buckle; increase the notch count to shorten h.`);
    }
    if (kAbs > pair.kappaClamp) {
      notch.warnings.push('Desired curvature exceeds the notch self-contact limit.');
    }
    notchResults.push(notch);
    z += h + c;
  }

  const worstEI = notchResults.reduce(
    (a, n) => Math.max(a, Math.abs(n.EIOuter - n.EIInner) / Math.max(1e-9, n.EIOuter, n.EIInner)),
    0,
  );
  if (worstEI > 0.25) {
    errors.push(
      'The inner tube cannot match the outer notch rigidity (EI mismatch ' +
        `${(worstEI * 100).toFixed(0)}%). Increase the inner tube wall or diameter, use a stiffer inner ` +
        'material, or choose a tighter bend so the EI constraint is easier to satisfy.',
    );
  } else if (worstEI > 0.08) {
    warnings.push(
      `Inner/outer notch EI mismatch reaches ${(worstEI * 100).toFixed(0)}%; the curvature profile will drift.`,
    );
  }

  if ((cfg.innerExtension || 0) > 0) {
    info.push(
      `Inner tube handle extension: ${(cfg.innerExtension).toFixed(0)} mm of solid tube beyond the outer tube at the base ` +
        '(for hand pull/push; included in the full + flex inner STL and laser pattern, not in the kinematics).',
    );
  }
  if ((cfg.outerExtension || 0) > 0) {
    info.push(
      `Outer tube solid extension: ${(cfg.outerExtension).toFixed(0)} mm beyond the base, joined to the outer transmission ` +
        '(included in the complete outer STL and laser pattern, not in the kinematics).',
    );
  }
  const coupler = cfg.transmission.coupler;
  if (coupler?.enabled) {
    const extO = Math.max(0, cfg.outerExtension || 0);
    const extI = Math.max(0, cfg.innerExtension || 0);
    if (coupler.tubes !== 'inner' && extO <= 0) warnings.push('Transmission coupler is enabled for the outer tube but no outer solid extension is set.');
    if (coupler.tubes !== 'outer' && extI <= 0) warnings.push('Transmission coupler is enabled for the inner tube but no inner solid extension is set.');
    const outerId = cfg.outerTube.od - 2 * cfg.outerTube.wall;
    const innerCouplerOd = cfg.innerTube.od + 2 * (coupler.clearance + coupler.wall);
    if (coupler.tubes !== 'outer' && innerCouplerOd > outerId - 2 * cfg.minClearance + 1e-6) {
      warnings.push(
        `Inner transmission coupler OD ${innerCouplerOd.toFixed(2)} mm exceeds the outer tube bore clearance; ` +
          'reduce its wall/clearance or use an outer-only coupler.',
      );
    }
    info.push(
      `Transmission coupler: ${coupler.length.toFixed(0)} mm separate sleeve on the ${coupler.tubes === 'both' ? 'outer and inner' : coupler.tubes} tube(s), ` +
        `wall ${coupler.wall.toFixed(2)} mm, clearance ${coupler.clearance.toFixed(2)} mm; exported as separate STL(s).`,
    );
  }
  if (cfg.transmission.pattern !== 'solid' && cfg.transmission.length > 0) {
    const txO = transmissionDesign(cfg, 'outer');
    const txI = transmissionDesign(cfg, 'inner');
    const minF = Math.min(txO.meta.minFeature || 99, txI.meta.minFeature || 99);
    if (txO.meta.segments > 0) {
      info.push(
        `Transmission: ${txO.meta.segments} bending segments × ${txO.meta.levels} rows × ` +
          `${txO.meta.slotsPerRev} slots/rev, ${txO.meta.slotAngleDeg.toFixed(0)}° slots, ` +
          `${txO.meta.postDeg.toFixed(0)}° posts, ${txO.meta.bridgeDeg.toFixed(0)}° bridges, ` +
          `${txO.meta.gap.toFixed(2)} mm solid gaps, min feature ${minF.toFixed(2)} mm.`,
      );
    }
    for (const note of [...txO.notes, ...txI.notes]) {
      if (!info.includes(note)) info.push(note);
    }
  }

  const activeTubeLength = z;
  if (c < outer.od / 2) {
    info.push(
      `Notch spacing c = ${c.toFixed(2)} mm is smaller than the outer radius; the rigid-section ` +
        'assumption is weaker. β ≈ 0.5 is recommended.',
    );
  }
  if (cfg.beta < 0.35 || cfg.beta > 0.65) {
    info.push('β outside 0.35–0.65: the notch/rigid ratio is far from the validated range (β ≈ 0.5).');
  }
  const deepest = Math.min(...notchResults.map((x) => x.gOuter)) / outer.od;
  if (notchResults.length > 0 && deepest < 0.5) {
    info.push('Some notches are shallower than 50 % of the OD; they will be relatively stiff.');
  }

  const qDesign = actuationForKappas(notches, kappaTargets);
  const designState = solveActuation(notches, qDesign, {
    lockout: cfg.firstNotchLockout,
    steps: 16,
  });
  const tauDesign = designState.tau;
  if (!designState.converged) {
    warnings.push('The exact model did not fully converge at the design actuation.');
  }

  // shape error
  const desiredPoly = curve.samples.map((p) => ({ x: p.x, z: p.z }));
  let sumSq = 0;
  for (const p of designState.shape) {
    const d = distanceToPolyline(p, desiredPoly);
    sumSq += d * d;
  }
  const rmsError = Math.sqrt(sumSq / Math.max(1, designState.shape.length)) / L;
  const desiredTip = curve.poseAt(L);
  const tipError = Math.hypot(designState.tip.x - desiredTip.x, designState.tip.z - desiredTip.z) / L;
  if (rmsError > 0.04) {
    warnings.push(
      `Model shape departs from the desired curve by ${(rmsError * 100).toFixed(1)} % of the active length ` +
        '(design approximation + finite-curvature effects).',
    );
  }

  // actuation sweep for the preview
  const fractions = [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 1.1, 1.2];
  const qs = fractions.map((f) => f * qDesign);
  const sweep = qs.length ? sweepActuation(notches, qs, { lockout: cfg.firstNotchLockout }) : [];

  const massVolume =
    notchResults.reduce((acc, r) => {
      const so = sectionProps(outer, cfg.cutType, r.gOuter);
      const si = sectionProps(inner, cfg.cutType, r.gInner);
      return acc + (so.area + si.area) * r.h;
    }, 0) +
    Math.PI * ((outer.od / 2) ** 2 - (outer.id / 2) ** 2) * n * c +
    Math.PI * ((inner.od / 2) ** 2 - (inner.id / 2) ** 2) * n * c;
  const mass = (massVolume * (matO.density + matI.density)) / 2 / 1000;

  return {
    segmentId: cfg.id,
    ok: errors.length === 0,
    errors,
    warnings,
    info,
    desiredShape: curve.resample(Math.max(160, n * 24)),
    desiredKappa,
    notches: notchResults,
    designState,
    sweep,
    qDesign,
    tauDesign,
    rmsError,
    tipError,
    activeTubeLength,
    kappaCapacity: capacity.kappa,
    mass,
    clearance,
    innerId: inner.id,
    outerId: outer.id,
    notchTable: notchResults,
  };
}

/** Convenience for display: centreline radius of the tightest notch. */
export function tightestRadius(res: SegmentResult): number | null {
  const k = res.notches.reduce((a, b) => Math.max(a, Math.abs(b.kappaTarget)), 0);
  return k > 0 ? 1 / k : null;
}

/** Total tube length including the transmission section. */
export function tubeLengths(cfg: SegmentConfig, res: SegmentResult): { outer: number; inner: number } {
  const trans = Math.max(0, cfg.transmission.length);
  return {
    outer: res.activeTubeLength + trans + Math.max(0, cfg.outerExtension || 0),
    inner: res.activeTubeLength + trans + Math.max(0, cfg.innerExtension || 0),
  };
}

export { buildShape };
