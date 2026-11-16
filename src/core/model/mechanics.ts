import { edgeStrains, type SectionProps } from '../geometry/section';
import type { ActuationState, Pose2D, ShapeSample } from '../types';

/** Geometry and elastic properties of one inner/outer notch pair. */
export interface NotchPair {
  index: number;
  /** notch axial length, mm */
  h: number;
  /** centreline length of the bending part, mm (design value) */
  l: number;
  /** rigid length after the notch, mm */
  c: number;
  gOuter: number;
  gInner: number;
  secOuter: SectionProps;
  secInner: SectionProps;
  /** |neutral axis offset| of each tube, mm */
  gammaOuterBar: number;
  gammaInnerBar: number;
  /** orientation sign: +1 for the notch cut that bends toward +X, −1 for the flipped notch */
  sign: 1 | -1;
  /** signed neutral-axis offsets in the global frame */
  gammaOuter: number;
  gammaInner: number;
  /** signed distance between neutral axes, mm */
  d: number;
  EIOuter: number;
  EIInner: number;
  EOuter: number;
  EInner: number;
  /** desired centreline curvature, 1/mm (signed) */
  kappaTarget: number;
  /** maximum |centreline curvature| before self-contact, 1/mm */
  kappaClamp: number;
}

export interface NotchStrains {
  outerBackbone: number;
  outerCut: number;
  innerBackbone: number;
  innerCut: number;
  max: number;
}

const EPS = 1e-12;

export function makeNotchPair(args: {
  index: number;
  kappaTarget: number;
  gOuter: number;
  gInner: number;
  h: number;
  l: number;
  c: number;
  secOuter: SectionProps;
  secInner: SectionProps;
  EOuter: number;
  EInner: number;
}): NotchPair {
  const sign: 1 | -1 = args.kappaTarget >= 0 ? 1 : -1;
  const gammaOuterBar = args.secOuter.gamma;
  const gammaInnerBar = args.secInner.gamma;
  const gammaOuter = -sign * gammaOuterBar;
  const gammaInner = sign * gammaInnerBar;
  const d = gammaInner - gammaOuter;
  const kappaClamp = 0.97 / args.secOuter.R; // 0.97 * 2/OD
  return {
    index: args.index,
    h: args.h,
    l: args.l,
    c: args.c,
    gOuter: args.gOuter,
    gInner: args.gInner,
    secOuter: args.secOuter,
    secInner: args.secInner,
    gammaOuterBar,
    gammaInnerBar,
    sign,
    gammaOuter,
    gammaInner,
    d,
    EIOuter: args.EOuter * args.secOuter.Iyy,
    EIInner: args.EInner * args.secInner.Iyy,
    EOuter: args.EOuter,
    EInner: args.EInner,
    kappaTarget: args.kappaTarget,
    kappaClamp,
  };
}

/** Outer-tube neutral-axis curvature from the centreline curvature (Eq. 4). */
export function kappaOuterOf(n: NotchPair, kappa: number): number {
  const den = 1 - n.gammaOuter * kappa;
  return den > EPS ? kappa / den : Math.sign(kappa) * 1e9;
}

/** Inner-tube neutral-axis curvature from the centreline curvature (Eq. 4). */
export function kappaInnerOf(n: NotchPair, kappa: number): number {
  const den = 1 - n.gammaInner * kappa;
  return den > EPS ? kappa / den : Math.sign(kappa) * 1e9;
}

/** Tension in the inner tube required to hold a notch at curvature kappa (Eq. 7). */
export function tensionAt(n: NotchPair, kappa: number): number {
  const ko = kappaOuterOf(n, kappa);
  const ki = kappaInnerOf(n, kappa);
  return (n.EIOuter * ko + n.EIInner * ki) / n.d;
}

/** Strains at the four notch edges (Eqs. 16–17). */
export function notchStrains(n: NotchPair, kappa: number): NotchStrains {
  const ko = kappaOuterOf(n, kappa);
  const ki = kappaInnerOf(n, kappa);
  const o = edgeStrains(n.secOuter, ko);
  const i = edgeStrains(n.secInner, ki);
  return {
    outerBackbone: o.back,
    outerCut: o.cut,
    innerBackbone: i.back,
    innerCut: i.cut,
    max: Math.max(o.back, o.cut, i.back, i.cut),
  };
}

/** Actuation displacement that produces the given centreline curvatures (Eq. 8). */
export function actuationForKappas(notches: NotchPair[], kappas: number[]): number {
  let q = 0;
  for (let j = 0; j < notches.length; j++) {
    q += notches[j].d * notches[j].h * kappaOuterOf(notches[j], kappas[j] ?? 0);
  }
  return q;
}

export interface ShapeBuildResult {
  samples: ShapeSample[];
  notchArcs: { index: number; sStart: number; sEnd: number; kappa: number }[];
  tip: Pose2D;
  totalLength: number;
}

/**
 * Build the centreline by stepping through constant-curvature notch arcs and
 * straight rigid sections.  The notch axial length h is fixed; the centreline
 * arc length over the notch follows Eq. (10) and therefore depends on curvature.
 */
export function buildShape(
  notches: NotchPair[],
  kappas: number[],
  opts: { lockedFirst?: boolean } = {},
): ShapeBuildResult {
  let x = 0;
  let z = 0;
  let psi = 0;
  let s = 0;
  const samples: ShapeSample[] = [{ s: 0, x, z, psi }];
  const notchArcs: { index: number; sStart: number; sEnd: number; kappa: number }[] = [];
  const pushArc = (kappa: number, length: number, steps: number) => {
    if (length <= 0) return;
    if (Math.abs(kappa) < 1e-10) {
      x += length * Math.sin(psi);
      z += length * Math.cos(psi);
      s += length;
      samples.push({ s, x, z, psi });
      return;
    }
    const dpsi = kappa * length;
    const step = dpsi / steps;
    const ds = length / steps;
    for (let k = 0; k < steps; k++) {
      const p0 = psi;
      const p1 = psi + step;
      x += (Math.cos(p0) - Math.cos(p1)) / kappa;
      z += (Math.sin(p1) - Math.sin(p0)) / kappa;
      psi = p1;
      s += ds;
      samples.push({ s, x, z, psi });
    }
  };

  for (let j = 0; j < notches.length; j++) {
    const n = notches[j];
    const kappa = kappas[j] ?? 0;
    let l = n.l;
    if (opts.lockedFirst && j === 0) {
      // The inner tube's solid section holds the first notch straight.
      l = n.h;
      notchArcs.push({ index: j, sStart: s, sEnd: s + l, kappa: 0 });
      pushArc(0, l, 1);
    } else {
      const den = 1 - n.gammaOuter * kappa;
      l = den > 0.05 ? n.h / den : n.h / 0.05;
      const bend = Math.abs(kappa * l);
      const steps = Math.max(3, Math.min(18, Math.ceil(bend / 0.12)));
      notchArcs.push({ index: j, sStart: s, sEnd: s + l, kappa });
      pushArc(kappa, l, steps);
    }
    // rigid spacing
    pushArc(0, n.c, 1);
  }
  return {
    samples,
    notchArcs,
    tip: { x, z, psi },
    totalLength: s,
  };
}

/* ------------------------------------------------------------------ */
/* Forward kinematics: solve for curvatures given actuation q          */
/* ------------------------------------------------------------------ */

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let acc = M[i][n];
    for (let c = i + 1; c < n; c++) acc -= M[i][c] * x[c];
    x[i] = acc / M[i][i];
  }
  return x;
}

interface SolveVars {
  kappaO: number[];
  tau: number;
  lockedFirst: boolean;
}

function residuals(notches: NotchPair[], active: number[], vars: SolveVars, q: number): number[] {
  const F: number[] = [];
  const { kappaO, tau } = vars;
  for (const j of active) {
    const n = notches[j];
    const ko = kappaO[j];
    const den = 1 - n.d * ko;
    const ki = den > 1e-9 ? ko / den : 1e9 * Math.sign(ko || 1);
    F.push(tau * n.d - n.EIOuter * ko - n.EIInner * ki);
  }
  let qq = 0;
  for (const j of active) qq += notches[j].d * notches[j].h * kappaO[j];
  F.push(qq - q);
  return F;
}

function tryNewton(
  notches: NotchPair[],
  active: number[],
  q: number,
  initial: SolveVars,
): { vars: SolveVars; ok: boolean; residual: number } {
  const vars: SolveVars = {
    kappaO: initial.kappaO.slice(),
    tau: initial.tau,
    lockedFirst: initial.lockedFirst,
  };
  const nv = active.length + 1;
  const scale = Math.max(1e-4, Math.abs(q) + 1e-3);
  // kappa_o bounds corresponding to the centreline self-contact limit in each
  // direction. These bounds also keep the 1 − d·kappa_o denominator positive.
  const kLo: number[] = [];
  const kHi: number[] = [];
  const branch = q >= 0 ? 1 : -1;
  for (const n of notches) {
    const a = kappaOuterOf(n, -n.kappaClamp);
    const b = kappaOuterOf(n, n.kappaClamp);
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    // Keep every notch on the physical branch: when the inner tube is pulled
    // (q > 0) the outer neutral-axis curvature has the same sign as d, and the
    // opposite sign when it is pushed.
    if (branch * Math.sign(n.d) > 0) lo = Math.max(lo, 0);
    else hi = Math.min(hi, 0);
    kLo.push(lo);
    kHi.push(hi);
  }
  const tauLo = branch > 0 ? 0 : -Infinity;
  const tauHi = branch > 0 ? Infinity : 0;
  let best = Infinity;
  for (let iter = 0; iter < 80; iter++) {
    const F0 = residuals(notches, active, vars, q);
    let norm = 0;
    for (let i = 0; i < F0.length - 1; i++) norm = Math.max(norm, Math.abs(F0[i]));
    norm = Math.max(norm, Math.abs(F0[F0.length - 1]) / scale);
    if (norm < 1e-7) return { vars, ok: true, residual: norm };
    best = Math.min(best, norm);

    // numerical Jacobian
    const J: number[][] = [];
    const base = residuals(notches, active, vars, q);
    for (let c = 0; c < nv; c++) {
      const v2: SolveVars = { kappaO: vars.kappaO.slice(), tau: vars.tau, lockedFirst: vars.lockedFirst };
      let hstep: number;
      if (c < active.length) {
        const j = active[c];
        hstep = 1e-8;
        v2.kappaO[j] += hstep;
        hstep = 1e-8;
      } else {
        hstep = 1e-7;
        v2.tau += hstep;
      }
      const Fp = residuals(notches, active, v2, q);
      const col: number[] = [];
      for (let r = 0; r < nv; r++) col.push((Fp[r] - base[r]) / hstep);
      J.push(col);
    }
    // J is column-major-ish: build row matrix
    const A: number[][] = [];
    for (let r = 0; r < nv; r++) {
      const row: number[] = [];
      for (let c = 0; c < nv; c++) {
        let val = J[c][r];
        if (r === nv - 1) val /= scale;
        row.push(val);
      }
      A.push(row);
    }
    const rhs = base.map((v, r) => (r === nv - 1 ? -v / scale : -v));
    const dx = solveLinear(A, rhs);
    if (!dx) return { vars, ok: false, residual: best };
    // line search
    let alpha = 1;
    let accepted = false;
    for (let ls = 0; ls < 12; ls++) {
      const trial: SolveVars = { kappaO: vars.kappaO.slice(), tau: vars.tau, lockedFirst: vars.lockedFirst };
      for (let c = 0; c < active.length; c++) {
        const j = active[c];
        let nk = vars.kappaO[j] + alpha * dx[c];
        nk = Math.max(kLo[j], Math.min(kHi[j], nk));
        trial.kappaO[j] = nk;
      }
      trial.tau = Math.max(tauLo, Math.min(tauHi, vars.tau + alpha * dx[active.length]));
      const Ft = residuals(notches, active, trial, q);
      let nt = 0;
      for (let i = 0; i < Ft.length - 1; i++) nt = Math.max(nt, Math.abs(Ft[i]));
      nt = Math.max(nt, Math.abs(Ft[Ft.length - 1]) / scale);
      if (nt < norm * (1 - 1e-6) || nt < 1e-7) {
        vars.kappaO = trial.kappaO;
        vars.tau = trial.tau;
        accepted = true;
        break;
      }
      alpha *= 0.5;
    }
    if (!accepted) {
      if (norm < 1e-5) break;
      // small damped step as a last resort
      for (let c = 0; c < active.length; c++) {
        const j = active[c];
        const nk = vars.kappaO[j] + 0.05 * dx[c];
        vars.kappaO[j] = Math.max(kLo[j], Math.min(kHi[j], nk));
      }
      vars.tau = Math.max(tauLo, Math.min(tauHi, vars.tau + 0.05 * dx[active.length]));
    }
  }
  const F = residuals(notches, active, vars, q);
  let norm = 0;
  for (let i = 0; i < F.length - 1; i++) norm = Math.max(norm, Math.abs(F[i]));
  norm = Math.max(norm, Math.abs(F[F.length - 1]) / scale);
  return { vars, ok: norm < 1e-6, residual: norm };
}

function evaluateState(
  notches: NotchPair[],
  active: number[],
  vars: SolveVars,
  q: number,
  converged: boolean,
  note?: string,
): ActuationState {
  const kappas: number[] = new Array(notches.length).fill(0);
  for (const j of active) {
    const ko = vars.kappaO[j];
    kappas[j] = ko / (1 + notches[j].gammaOuter * ko);
  }
  const shape = buildShape(notches, kappas, { lockedFirst: vars.lockedFirst });
  let maxStrain = 0;
  for (let j = 0; j < notches.length; j++) {
    if (vars.lockedFirst && j === 0) continue;
    maxStrain = Math.max(maxStrain, notchStrains(notches[j], kappas[j]).max);
  }
  return {
    q,
    tau: vars.tau,
    kappas,
    kappasOuter: vars.kappaO.slice(),
    shape: shape.samples,
    notchArcs: shape.notchArcs,
    tip: shape.tip,
    maxStrain,
    converged,
    note,
  };
}

/** Solve the forward kinematics for a single actuation value. */
export function solveActuation(
  notches: NotchPair[],
  q: number,
  opts: { lockout?: boolean; initial?: ActuationState; steps?: number } = {},
): ActuationState {
  if (notches.length === 0) {
    return {
      q, tau: 0, kappas: [], kappasOuter: [], shape: [{ s: 0, x: 0, z: 0, psi: 0 }], notchArcs: [],
      tip: { x: 0, z: 0, psi: 0 }, maxStrain: 0, converged: true,
    };
  }
  const lockedFirst = !!opts.lockout && q < -1e-9 && notches.length > 1;
  const active: number[] = [];
  for (let j = 0; j < notches.length; j++) if (!(lockedFirst && j === 0)) active.push(j);

  // linear initial guess
  const makeGuess = (scaleQ: number, seed?: SolveVars): SolveVars => {
    const kO = new Array(notches.length).fill(0);
    if (seed) return { kappaO: [...seed.kappaO], tau: seed.tau, lockedFirst };
    let sum = 0;
    for (const j of active) {
      const n = notches[j];
      sum += (n.d * n.d * n.h) / (n.EIOuter + n.EIInner);
    }
    const tau = sum > 1e-15 ? scaleQ / sum : 0;
    for (const j of active) {
      const n = notches[j];
      kO[j] = (tau * n.d) / (n.EIOuter + n.EIInner);
    }
    return { kappaO: kO, tau, lockedFirst };
  };

  const N = Math.max(4, opts.steps ?? 10);
  const target = q;
  let solved: SolveVars | null = null;
  if (opts.initial && opts.initial.converged && opts.initial.kappasOuter.length === notches.length) {
    // Warm start by scaling the previous solution; accept only if Newton converges.
    const q0 = opts.initial.q;
    const fac = Math.abs(q0) > 1e-9 ? target / q0 : 0;
    const kO = opts.initial.kappasOuter.map((k) => k * fac);
    const warm = tryNewton(notches, active, target, {
      kappaO: kO, tau: opts.initial.tau * fac, lockedFirst,
    });
    if (warm.ok) solved = warm.vars;
  }
  if (!solved) {
    let qc = 0;
    let vars = makeGuess(0);
    // zero state
    const zero = tryNewton(notches, active, 0, vars);
    vars = zero.vars;
    let step = target / N;
    let guard = 0;
    let failed = false;
    while (Math.abs(target - qc) > Math.abs(target) * 1e-6 + 1e-9 && guard++ < 200) {
      if (Math.abs(step) < 1e-9) { failed = true; break; }
      let trialQ = qc + step;
      if ((trialQ - target) * Math.sign(target) > 0) {
        step = target - qc;
        trialQ = target;
      }
      const res = tryNewton(notches, active, trialQ, vars);
      if (res.ok || res.residual < 1e-7) {
        vars = res.vars;
        qc = trialQ;
        step *= 1.35;
      } else {
        step *= 0.4;
        if (Math.abs(step) < Math.abs(target) * 1e-5) { failed = true; break; }
      }
    }
    solved = vars;
    if (failed) {
      const st = evaluateState(notches, active, vars, qc, false, 'Solver reached the workspace boundary');
      return st;
    }
  }
  const F = residuals(notches, active, solved, target);
  let norm = 0;
  for (let i = 0; i < F.length - 1; i++) norm = Math.max(norm, Math.abs(F[i]));
  norm = Math.max(norm, Math.abs(F[F.length - 1]) / Math.max(1e-4, Math.abs(target)));
  const state = evaluateState(notches, active, solved, target, norm < 1e-5);
  if (!state.converged) state.note = 'Actuation is outside the smooth workspace (notch contact)';
  return state;
}

/** Actuation sweep ordered by q, warm-started for continuity. */
export function sweepActuation(
  notches: NotchPair[],
  qs: number[],
  opts: { lockout?: boolean } = {},
): ActuationState[] {
  const sorted = [...qs].sort((a, b) => a - b);
  const out: ActuationState[] = [];
  let prev: ActuationState | undefined;
  for (const q of sorted) {
    const st = solveActuation(notches, q, { lockout: opts.lockout, initial: prev });
    out.push(st);
    if (st.converged) prev = st;
  }
  // return in the caller's order
  return qs.map((q) => out[sorted.indexOf(q)]);
}
