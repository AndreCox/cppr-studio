import type { SegmentConfig, TransmissionPattern } from '../types';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const norm2pi = (a: number) => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};

/** One circumferential laser/print slot on the unrolled tube. */
export interface TransmissionCut {
  /** centre angle, rad (0 = +X) */
  angleCenter: number;
  /** angular span, rad */
  angleSpan: number;
  z0: number;
  z1: number;
}

export interface TransmissionMeta {
  /** pattern type */
  pattern: SegmentConfig['transmission']['pattern'];
  /** number of discrete bending segments */
  segments: number;
  /** number of slot rows/levels per segment */
  levels: number;
  /** number of slots per revolution */
  slotsPerRev: number;
  /** angular slot width, deg */
  slotAngleDeg: number;
  /** angular post width α, deg */
  postDeg: number;
  /** angular bridge width β, deg */
  bridgeDeg: number;
  /** solid gap between segments, mm */
  gap: number;
  /** bending-segment length Lb, mm */
  segmentLength: number;
  /** slot kerf, mm */
  kerf: number;
  /** pitch between rows, mm */
  pitch: number;
  /** smallest solid feature (kerf or post/bridge arc), mm */
  minFeature: number;
  achievableCurvature: number;
  requiredCurvature: number;
  slotCount: number;
  /** z where the pattern starts (proximal solid lead-in), mm */
  leadIn: number;
}

export function effectiveTransmissionPattern(
  cfg: SegmentConfig,
  tube: 'outer' | 'inner',
): TransmissionPattern {
  const tr = cfg.transmission;
  if (tube === 'inner' && tr.innerPattern && tr.innerPattern !== 'same') return tr.innerPattern;
  return tr.pattern;
}

export interface TransmissionDesign {
  cuts: TransmissionCut[];
  meta: TransmissionMeta;
  notes: string[];
}

interface TubeGeom {
  R: number;
  a: number;
}

function tubeProps(cfg: SegmentConfig, tube: 'outer' | 'inner'): TubeGeom {
  const spec = tube === 'outer' ? cfg.outerTube : cfg.innerTube;
  return { R: spec.od / 2, a: Math.max(0, spec.od / 2 - spec.wall) };
}

/**
 * Transmission pattern geometry.
 *
 * Discrete asymmetric design (Dang et al., ISMR 2024): each bending segment
 * contains `levels` rows of `n` circumferential slots.  Every row leaves two
 * posts of angular width α 180° apart and (n−2) intermediate solid bridges of
 * width β.  Rows within one segment are aligned so the posts remain continuous;
 * successive segments are riffled by the golden angle.
 *
 * Brickwork: staggered rows of short circumferential slots.
 */
export function transmissionDesign(
  cfg: SegmentConfig,
  tube: 'outer' | 'inner',
): TransmissionDesign {
  const tr = cfg.transmission;
  const pattern = effectiveTransmissionPattern(cfg, tube);
  const T = Math.max(0, tr.length);
  const { R, a } = tubeProps(cfg, tube);
  const clearance = Math.max(0.02, (cfg.outerTube.od - 2 * cfg.outerTube.wall - cfg.innerTube.od) / 2);
  const notes: string[] = [];
  const emptyMeta: TransmissionMeta = {
    pattern, segments: 0, levels: 0, slotsPerRev: 0,
    slotAngleDeg: 0, postDeg: tr.separationDeg, bridgeDeg: tr.overlapDeg,
    gap: 0, segmentLength: 0, kerf: tr.kerf, pitch: tr.pitch,
    minFeature: 0, achievableCurvature: 0, requiredCurvature: tr.maxCurvature,
    slotCount: 0, leadIn: 0,
  };
  if (pattern === 'solid' || T <= 0) {
    return { cuts: [], meta: emptyMeta, notes: ['The transmission section is solid.'] };
  }

  const cuts: TransmissionCut[] = [];
  const leadIn = Math.min(1, Math.max(0.25, tr.kerf));
  const k = clamp(tr.kerf, 0.01, 10);
  const pitch = Math.max(k * 1.02, tr.pitch);

  if (pattern === 'brickwork') {
    const n = Math.max(2, Math.round(tr.cutsPerRev));
    const duty = clamp(0.5 + tr.overlapDeg / 90, 0.35, 0.9);
    const slotSpan = ((TAU / n) * duty);
    const rows = Math.max(0, Math.floor((T - leadIn) / pitch));
    for (let r = 0; r < rows; r++) {
      const z0 = leadIn + r * pitch;
      const z1 = Math.min(T, z0 + k);
      const off = (r % 2) * (TAU / n / 2);
      for (let i = 0; i < n; i++) {
        const center = norm2pi(off + (i * TAU) / n);
        cuts.push({ angleCenter: center, angleSpan: slotSpan, z0, z1 });
      }
    }
    const arc = ((R + a) / 2) * (TAU / n - slotSpan);
    const minFeature = Math.min(k, Math.max(0, arc));
    if (minFeature < 0.35) {
      notes.push(
        `Smallest solid feature is ${minFeature.toFixed(2)} mm. FDM printers need ≈0.4 mm; ` +
          'increase the kerf or use a coarser pattern for printing.',
      );
    }
    return {
      cuts,
      meta: {
        ...emptyMeta,
        segments: rows, levels: 1, slotsPerRev: n,
        slotAngleDeg: (slotSpan / DEG), postDeg: 0, bridgeDeg: (TAU / n - slotSpan) / DEG,
        gap: 0, segmentLength: k, kerf: k, pitch, minFeature,
        achievableCurvature: 0,
        slotCount: cuts.length, leadIn,
      },
      notes,
    };
  }

  // Discrete asymmetric design
  const nRaw = Math.max(2, Math.round(tr.cutsPerRev));
  const n = nRaw % 2 === 0 ? nRaw : nRaw + 1;
  const levels = Math.max(2, Math.round(tr.levels));
  const Lb = (levels - 1) * pitch + k;
  let gap = Math.max(0, tr.gap);
  let achievable = 0;
  if (gap > 0) {
    const L = 2 * (Lb + gap);
    achievable = (8 * clearance) / (L * L);
  } else {
    // Eq. (1) of the transmission paper: κ_max ≈ 8c / L², L = 2(Lb + g)
    const L = tr.maxCurvature > 1e-9 ? Math.sqrt((8 * clearance) / tr.maxCurvature) : Infinity;
    gap = Math.max(0, Number.isFinite(L) ? L / 2 - Lb : 0);
    achievable = tr.maxCurvature;
  }
  const period = Lb + gap;
  const segments = Math.max(0, Math.floor((T - leadIn + 1e-9) / period));
  const alpha = clamp(tr.separationDeg, 1, 120) * DEG;
  const beta = clamp(tr.overlapDeg, 1, 120) * DEG;
  const perHalf = n / 2;
  const minSlot = 3 * DEG;
  let slotAngle = (Math.PI - alpha - (perHalf - 1) * beta) / perHalf;
  let betaAdj = beta;
  if (slotAngle <= minSlot) {
    betaAdj = Math.max(0, (Math.PI - alpha - perHalf * minSlot) / Math.max(1, perHalf - 1));
    slotAngle = minSlot;
    notes.push(
      'The requested overlap angle leaves too little slot width. Reduce α or β; β was clamped ' +
        `to ${(betaAdj / DEG).toFixed(1)}° so the slots remain open.`,
    );
  }
  if (pitch < k * 1.02) {
    notes.push('Row pitch is close to the kerf; the rows may merge. Increase the pitch.');
  }

  const riffle = (tr.riffleDeg || 68.75) * DEG;
  for (let s = 0; s < segments; s++) {
    const base = s * riffle + (tube === 'inner' ? Math.PI / 2 : 0);
    for (let l = 0; l < levels; l++) {
      const zc = leadIn + s * period + l * pitch + k / 2;
      const z0 = zc - k / 2;
      const z1 = Math.min(T, zc + k / 2);
      if (z1 - z0 < 1e-6) continue;
      for (let half = 0; half < 2; half++) {
        const start0 = base + half * Math.PI + alpha / 2;
        for (let i = 0; i < perHalf; i++) {
          const start = start0 + i * (slotAngle + betaAdj);
          cuts.push({
            angleCenter: norm2pi(start + slotAngle / 2),
            angleSpan: slotAngle,
            z0,
            z1,
          });
        }
      }
    }
  }

  const postArc = ((R + a) / 2) * alpha;
  const bridgeArc = ((R + a) / 2) * betaAdj;
  const minFeature = Math.min(k, postArc, bridgeArc);
  if (minFeature < 0.35) {
    notes.push(
      `Smallest solid feature is ${minFeature.toFixed(2)} mm (kerf ${k.toFixed(2)}, posts ` +
        `${postArc.toFixed(2)}, bridges ${bridgeArc.toFixed(2)}). FDM printers need ≈0.4 mm; ` +
        'increase the kerf or use a coarser pattern for printed transmissions.',
    );
  }
  if (gap === 0 && achievable < tr.maxCurvature - 1e-9) {
    notes.push(
      `The requested curvature ${(tr.maxCurvature * 1000).toFixed(1)} 1/m needs a solid gap; ` +
        `the pattern currently allows ${(achievable * 1000).toFixed(1)} 1/m. Increase the pitch or reduce the curvature requirement.`,
    );
  }

  return {
    cuts,
    meta: {
      pattern, segments, levels, slotsPerRev: n,
      slotAngleDeg: slotAngle / DEG, postDeg: alpha / DEG, bridgeDeg: betaAdj / DEG,
      gap, segmentLength: Lb, kerf: k, pitch, minFeature,
      achievableCurvature: achievable, requiredCurvature: tr.maxCurvature,
      slotCount: cuts.length, leadIn,
    },
    notes,
  };
}
