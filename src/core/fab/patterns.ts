import { sectionProps } from '../geometry/section';
import type { SegmentConfig, SegmentResult, TubeSpec } from '../types';
import { norm2pi } from './build';
import { transmissionDesign } from './transmission';

export interface CutRegion {
  /** unrolled circumferential coordinate, mm */
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  kind: 'notch' | 'transmission';
}

export interface PatternHole {
  /** unrolled circumferential centre, mm */
  u: number;
  z: number;
  diameter: number;
}

export interface PatternMeta {
  patternLength: number;
  gap: number;
  achievableCurvature: number;
  requiredCurvature: number;
  cutCount: number;
  segments?: number;
  levels?: number;
  slotsPerRev?: number;
  slotAngleDeg?: number;
  postDeg?: number;
  bridgeDeg?: number;
  minFeature?: number;
  leadIn?: number;
}

export interface TubePattern {
  key: string;
  label: string;
  tube: 'outer' | 'inner';
  radius: number;
  circumference: number;
  length: number;
  activeStart: number;
  activeEnd: number;
  regions: CutRegion[];
  /** circular cross-pin holes (both 180° openings) */
  holes: PatternHole[];
  meta: PatternMeta;
  notes: string[];
}

const TAU = Math.PI * 2;

function tubeGeom(t: TubeSpec) {
  return { od: t.od, id: t.od - 2 * t.wall };
}

function wrapRegions(centerU: number, halfArc: number, circ: number, z0: number, z1: number, kind: CutRegion['kind']): CutRegion[] {
  const width = Math.min(circ, Math.max(0, 2 * halfArc));
  if (width >= circ - 1e-6) return [{ u0: 0, u1: circ, z0, z1, kind }];
  const start = ((centerU - width / 2) % circ + circ) % circ;
  const end = start + width;
  if (end <= circ) return [{ u0: start, u1: end, z0, z1, kind }];
  return [
    { u0: start, u1: circ, z0, z1, kind },
    { u0: 0, u1: end - circ, z0, z1, kind },
  ].filter((r) => r.u1 - r.u0 > 1e-6);
}

/** Convert the shared transmission geometry into unrolled cut rectangles. */
function transmissionRegions(
  cfg: SegmentConfig,
  R: number,
  include: boolean,
  tube: 'outer' | 'inner',
  zOffset = 0,
): { regions: CutRegion[]; meta: PatternMeta; notes: string[] } {
  if (!include) {
    return {
      regions: [],
      meta: {
        patternLength: 0,
        gap: 0,
        achievableCurvature: 0,
        requiredCurvature: cfg.transmission.maxCurvature,
        cutCount: 0,
        slotsPerRev: 0,
        slotAngleDeg: 0,
        leadIn: 0,
      },
      notes: [],
    };
  }
  const design = transmissionDesign(cfg, tube);
  const circ = TAU * R;
  const regions: CutRegion[] = [];
  for (const c of design.cuts) {
    const halfArc = (c.angleSpan / 2) * R;
    regions.push(...wrapRegions(c.angleCenter * R, halfArc, circ, c.z0 + zOffset, c.z1 + zOffset, 'transmission'));
  }
  const m = design.meta;
  return {
    regions,
    meta: {
      patternLength: m.segments,
      gap: m.gap,
      achievableCurvature: m.achievableCurvature,
      requiredCurvature: m.requiredCurvature,
      cutCount: regions.length,
      segments: m.segments,
      levels: m.levels,
      slotsPerRev: m.slotsPerRev,
      slotAngleDeg: m.slotAngleDeg,
      postDeg: m.postDeg,
      bridgeDeg: m.bridgeDeg,
      minFeature: m.minFeature,
      leadIn: m.leadIn,
    },
    notes: design.notes,
  };
}

export function buildLaserPatterns(cfg: SegmentConfig, res: SegmentResult, includeTransmission = true): TubePattern[] {
  const out: TubePattern[] = [];
  const leadIn = Math.min(3, Math.max(0.5, (res.notches[0]?.c ?? 1) / 2));
  const tubes: { tube: 'outer' | 'inner'; spec: TubeSpec; label: string; phi: (i: number) => number; g: (i: number) => number }[] = [
    {
      tube: 'outer',
      spec: cfg.outerTube,
      label: 'Outer tube',
      phi: (i) => res.notches[i].phiOuter,
      g: (i) => res.notches[i].gOuter,
    },
    {
      tube: 'inner',
      spec: cfg.innerTube,
      label: 'Inner tube',
      phi: (i) => res.notches[i].phiInner,
      g: (i) => res.notches[i].gInner,
    },
  ];

  for (const t of tubes) {
    const geom = tubeGeom(t.spec);
    const R = geom.od / 2;
    const circ = TAU * R;
    const coupler = cfg.transmission.coupler;
    const solidEnd = Math.max(0, coupler?.length ?? 0);
    const extension = (t.tube === 'inner' ? Math.max(0, cfg.innerExtension || 0) : Math.max(0, cfg.outerExtension || 0)) +
      (coupler?.enabled && (coupler.tubes === 'both' || coupler.tubes === t.tube) ? solidEnd : 0);
    const activeStart = cfg.transmission.length + leadIn + extension;
    const total = activeStart + res.activeTubeLength;
    const tipExtension = cfg.tipFeature?.enabled ? Math.max(0, cfg.tipFeature.extension) : 0;
    const regions: CutRegion[] = [];
    res.notches.forEach((n, i) => {
      const sec = sectionProps(geom, cfg.cutType, t.g(i));
      const halfArc = R * sec.theta;
      const cutAngle = norm2pi(t.phi(i) - Math.PI);
      const z0 = activeStart + n.zCenter - n.h / 2;
      const z1 = z0 + n.h;
      regions.push(...wrapRegions((cutAngle * R), halfArc, circ, z0, z1, 'notch'));
    });
    const tr = transmissionRegions(cfg, R, includeTransmission, t.tube, extension);
    const notes = [...tr.notes];
    const holes: PatternHole[] = [];
    if (tipExtension > 0) {
      const holeZ = total + tipExtension - cfg.tipFeature.holeDistance;
      const holeAngle = (cfg.tipFeature.angleDeg * Math.PI) / 180;
      for (const off of [0, Math.PI]) {
        holes.push({ u: norm2pi(holeAngle + off) * R, z: holeZ, diameter: cfg.tipFeature.holeDiameter });
      }
      notes.push(
        `Tip cross-pin: Ø${cfg.tipFeature.holeDiameter.toFixed(2)} mm hole ${cfg.tipFeature.holeDistance.toFixed(1)} mm from the ` +
          `extended tip, two openings 180° apart. Cut both circles on each tube.`,
      );
    }
    if (extension > 0) {
      notes.push(
        t.tube === 'inner'
          ? `Inner tube handle extension: ${extension.toFixed(0)} mm of solid tube at the proximal end for hand actuation. ` +
            'It is included in the complete inner STL and in this pattern (before the transmission slots). Align the distal tips when assembling.'
          : `Outer tube solid extension: ${extension.toFixed(0)} mm of solid tube at the proximal end, joined to the transmission. ` +
            'It is included in the complete outer STL and in this pattern (before the transmission slots).',
      );
    }
    if (includeTransmission && coupler?.enabled && coupler.length > 0 && (coupler.tubes === 'both' || coupler.tubes === t.tube)) {
      notes.push(
        `Solid proximal end section: ${coupler.length.toFixed(0)} mm of solid ${t.tube} tube added after the transmission. ` +
          'It is part of the complete tube and this pattern; no separate coupler part.',
      );
    }
    const all = [...tr.regions, ...regions].sort((a, b) => a.z0 - b.z0);
    out.push({
      key: `${cfg.id}-${t.tube}`,
      label: `${cfg.name} · ${t.label}`,
      tube: t.tube,
      radius: R,
      circumference: circ,
      length: total + tipExtension,
      activeStart,
      activeEnd: total,
      regions: all,
      holes,
      meta: { ...tr.meta, cutCount: tr.meta.cutCount + holes.length },
      notes,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Layout + vector export                                              */
/* ------------------------------------------------------------------ */

export interface PatternPanel {
  pattern: TubePattern;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PatternLayout {
  width: number;
  height: number;
  panels: PatternPanel[];
  margin: number;
  headerHeight: number;
  gap: number;
}

export function layoutPatterns(patterns: TubePattern[], opts: { margin?: number; gap?: number; header?: number } = {}): PatternLayout {
  const margin = opts.margin ?? 12;
  const gap = opts.gap ?? 18;
  const headerHeight = opts.header ?? 34;
  const maxWidth = Math.max(80, ...patterns.map((p) => p.circumference));
  let y = margin + headerHeight;
  let height = y;
  const panels: PatternPanel[] = [];
  for (const p of patterns) {
    panels.push({ pattern: p, x: margin, y, width: p.circumference, height: p.length });
    y += p.length + gap + 14;
    height = y;
  }
  return {
    width: margin * 2 + maxWidth,
    height: height + margin - gap - 14 + 10,
    panels,
    margin,
    headerHeight,
    gap,
  };
}

export function regionPath(region: CutRegion): string {
  const w = region.u1 - region.u0;
  const h = region.z1 - region.z0;
  return `M ${region.u0.toFixed(3)} ${region.z0.toFixed(3)} h ${w.toFixed(3)} v ${h.toFixed(3)} h ${(-w).toFixed(3)} z`;
}

export function patternToSvg(
  patterns: TubePattern[],
  title: string,
  subtitle: string,
): string {
  const layout = layoutPatterns(patterns);
  const { margin } = layout;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body: string[] = [];
  body.push(`<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`);
  const titleText = title.length > 52 ? `${title.slice(0, 49)}…` : title;
  body.push(`<text x="${margin}" y="${margin + 6}" font-family="Helvetica, Arial, sans-serif" font-size="4.6" font-weight="bold" fill="#0f172a">${esc(titleText)}</text>`);
  body.push(`<text x="${margin}" y="${margin + 12}" font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#475569">${esc(subtitle)} · unrolled pattern · 1 unit = 1 mm</text>`);
  body.push(`<text x="${margin}" y="${margin + 18}" font-family="Helvetica, Arial, sans-serif" font-size="2.2" fill="#64748b">Cut only the red CUT layer. The unrolled view is wrapped around the outer surface; the seam is at u = 0 / 360°.</text>`);
  for (const panel of layout.panels) {
    const p = panel.pattern;
    const { x, y, width, height } = panel;
    const g = (s: string) => s;
    body.push(`<g transform="translate(${x} ${y})">`);
    body.push(`<text x="0" y="-5" font-family="Helvetica, Arial, sans-serif" font-size="3.6" font-weight="bold" fill="#0f172a">${esc(p.label)} — ⌀${(p.radius * 2).toFixed(2)} mm, circumference ${p.circumference.toFixed(1)} mm, length ${p.length.toFixed(1)} mm</text>`);
    body.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.15"/>`);
    // active region band
    body.push(`<rect x="0" y="${p.activeStart}" width="${width}" height="${Math.max(0.05, p.activeEnd - p.activeStart)}" fill="#fff7ed" opacity="0.85"/>`);
    // angle rulers
    for (let a = 0; a <= 360; a += 90) {
      const u = (a / 360) * width;
      body.push(`<line x1="${u}" y1="0" x2="${u}" y2="${height}" stroke="#e2e8f0" stroke-width="0.08" stroke-dasharray="1.2 1.2"/>`);
    }
    body.push(`<g class="cut-layer" fill="none" stroke="#ff0000" stroke-width="0.06" stroke-linejoin="miter">`);
    for (const r of p.regions) {
      body.push(`<path d="${regionPath(r)}" />`);
    }
    for (const h of p.holes) {
      body.push(`<circle cx="${(h.u).toFixed(3)}" cy="${(h.z).toFixed(3)}" r="${(h.diameter / 2).toFixed(3)}" />`);
    }
    body.push('</g>');
    // z dimension
    body.push(`<line x1="-5" y1="0" x2="-5" y2="${height}" stroke="#94a3b8" stroke-width="0.12"/>`);
    body.push(`<text x="-6.5" y="${height / 2}" transform="rotate(-90 -6.5 ${height / 2})" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="#64748b">z ${height.toFixed(0)} mm</text>`);
    body.push(`<text x="0" y="-1.4" font-family="Helvetica, Arial, sans-serif" font-size="2" fill="#94a3b8">u = 0°</text>`);
    body.push(`<text x="${width}" y="-1.4" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="2" fill="#94a3b8">360°</text>`);
    body.push(`</g>`);
    void g;
  }
  body.push(`<g font-family="Helvetica, Arial, sans-serif" font-size="2.8" fill="#475569">`);
  let ly = layout.height - margin + 2;
  body.push(`<text x="${margin}" y="${ly}">Legend: <tspan fill="#e11d48">active CPPR notch</tspan> · <tspan fill="#94a3b8">transmission flex slot</tspan> · shaded band = active (bending) section.</text>`);
  body.push(`<text x="${margin}" y="${ly + 4}">Cut only the red CUT layer. Rectangles are outlines on the unrolled outer surface; for radial-notch designs the laser cuts them through the wall. Chord (milled) designs need a 4-axis cut or printing.</text>`);
  body.push(`</g>`);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}mm" height="${layout.height}mm" viewBox="0 0 ${layout.width} ${layout.height}">`,
    ...body,
    `</svg>`,
  ].join('\n');
}

export function patternToDxf(patterns: TubePattern[]): string {
  const layout = layoutPatterns(patterns);
  const lines: string[] = [];
  const p = (code: number, val: string | number) => {
    lines.push(String(code));
    lines.push(String(val));
  };
  p(0, 'SECTION'); p(2, 'HEADER');
  p(9, '$INSUNITS'); p(70, 4);
  p(9, '$EXTMIN'); p(10, 0); p(20, 0); p(30, 0);
  p(9, '$EXTMAX'); p(10, layout.width); p(20, layout.height); p(30, 0);
  p(0, 'ENDSEC');
  p(0, 'SECTION'); p(2, 'TABLES');
  p(0, 'TABLE'); p(2, 'LAYER'); p(70, 2);
  p(0, 'LAYER'); p(2, 'CUT'); p(70, 0); p(62, 1); p(6, 'CONTINUOUS');
  p(0, 'LAYER'); p(2, 'REF'); p(70, 0); p(62, 8); p(6, 'CONTINUOUS');
  p(0, 'ENDTAB');
  p(0, 'ENDSEC');
  p(0, 'SECTION'); p(2, 'ENTITIES');
  const emitRect = (x0: number, y0: number, x1: number, y1: number, layer: string) => {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      p(0, 'LINE'); p(8, layer);
      p(10, a[0].toFixed(4)); p(20, (layout.height - a[1]).toFixed(4)); p(30, 0);
      p(11, b[0].toFixed(4)); p(21, (layout.height - b[1]).toFixed(4)); p(31, 0);
    }
  };
  for (const panel of layout.panels) {
    const { x, y, width, height } = panel;
    emitRect(x, y, x + width, y + height, 'REF');
    for (const r of panel.pattern.regions) {
      emitRect(x + r.u0, y + r.z0, x + r.u1, y + r.z1, 'CUT');
    }
    for (const h of panel.pattern.holes) {
      p(0, 'CIRCLE'); p(8, 'CUT');
      p(10, (x + h.u).toFixed(4)); p(20, (layout.height - (y + h.z)).toFixed(4)); p(30, 0);
      p(40, (h.diameter / 2).toFixed(4));
    }
  }
  p(0, 'ENDSEC');
  p(0, 'EOF');
  return lines.join('\n');
}
