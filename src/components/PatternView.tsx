import React, { useMemo, useState } from 'react';
import type { SegmentConfig, SegmentResult } from '../core/types';
import { buildLaserPatterns, layoutPatterns } from '../core/fab/patterns';
import { Button, Icon, Segmented } from './ui';

interface Props {
  cfg: SegmentConfig;
  res: SegmentResult | undefined;
  onExportSvg: () => void;
  onExportDxf: () => void;
}

export function PatternView({ cfg, res, onExportSvg, onExportDxf }: Props) {
  const [tube, setTube] = useState<'outer' | 'inner'>('outer');
  const [includeTx, setIncludeTx] = useState(cfg.transmission.length < 350);
  const [fullLength, setFullLength] = useState(cfg.transmission.length > 0 && cfg.transmission.length < 260);

  const patterns = useMemo(
    () => (res ? buildLaserPatterns(cfg, res, includeTx) : []),
    [cfg, res, includeTx],
  );
  const layout = useMemo(() => layoutPatterns(patterns), [patterns]);
  const pattern = patterns.find((p) => p.tube === tube) ?? patterns[0];

  if (!res || !pattern) {
    return (
      <div className="empty-state">
        <div className="big">Nothing to cut yet</div>
        <p>Complete the segment design to generate the unrolled notch pattern.</p>
      </div>
    );
  }

  const cropped = !fullLength;
  const zStart = cropped ? Math.max(0, pattern.activeStart - Math.max(6, pattern.length * 0.03)) : 0;
  const zEnd = cropped
    ? Math.min(pattern.length, pattern.activeEnd + Math.max(6, pattern.length - pattern.activeEnd + 2, pattern.length * 0.015))
    : pattern.length;
  const w = Math.max(10, zEnd - zStart);
  const circ = pattern.circumference;
  const font = Math.max(0.7, Math.min(w * 0.02, circ * 0.075));

  const rects = pattern.regions.filter((r) => r.z1 > zStart && r.z0 < zEnd);
  const holes = pattern.holes.filter((h) => h.z > zStart - h.diameter && h.z < zEnd + h.diameter);
  const ticks: React.ReactNode[] = [];
  const tickStep = w > 600 ? 100 : w > 250 ? 50 : w > 100 ? 20 : 10;
  for (let z = Math.ceil(zStart / tickStep) * tickStep; z <= zEnd; z += tickStep) {
    ticks.push(
      <g key={`t${z}`}>
        <line x1={z} y1={0} x2={z} y2={circ * 0.045} stroke="#64748b" strokeWidth={font * 0.05} />
        <text x={z} y={circ * 0.16} className="dim-text" style={{ fontSize: font * 0.85, fill: '#64748b' }} textAnchor="middle">{z.toFixed(0)}</text>
      </g>,
    );
  }
  for (let a = 0; a <= 360; a += 90) {
    const u = (a / 360) * circ;
    ticks.push(
      <g key={`a${a}`}>
        <line x1={zStart} y1={-u} x2={zEnd} y2={-u} stroke="#dbe3ec" strokeWidth={0.05} vectorEffect="non-scaling-stroke" />
        <text x={zStart - w * 0.008} y={-u + font * 0.3} className="dim-text" style={{ fontSize: font * 0.8, fill: '#64748b' }} textAnchor="end">{a}°</text>
      </g>,
    );
  }

  const meta = pattern.meta;
  return (
    <div className="section-wrap" style={{ flexDirection: 'column' }}>
      <div className="pattern-toolbar">
        <Segmented
          value={tube}
          onChange={(v) => setTube(v)}
          options={[{ value: 'outer', label: 'Outer tube' }, { value: 'inner', label: 'Inner tube' }]}
        />
        <label className="toggle" style={{ marginLeft: 10, fontSize: 11 }}>
          <input type="checkbox" checked={includeTx} onChange={(e) => setIncludeTx(e.target.checked)} />
          <span>Preview transmission pattern</span>
        </label>
        <label className="toggle" style={{ marginLeft: 6, fontSize: 11 }}>
          <input type="checkbox" checked={fullLength} onChange={(e) => setFullLength(e.target.checked)} />
          <span>Full length</span>
        </label>
        <div className="grow" />
        <span className="tiny faint pattern-count">{pattern.regions.length} cuts · {pattern.length.toFixed(0)} mm long</span>
        <Button size="sm" icon="download" onClick={onExportSvg}>SVG</Button>
        <Button size="sm" icon="download" onClick={onExportDxf}>DXF</Button>
      </div>
      <div className="pattern-wrap" style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
        <svg
          viewBox={`${zStart - w * 0.035} ${-circ - circ * 0.3} ${w * 1.07} ${circ * 1.57}`}
          style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block' }}
          preserveAspectRatio="xMidYMid meet"
          className="pattern-svg"
        >
          <rect x={zStart} y={-circ} width={w} height={circ} fill="#f8fafc" stroke="#64748b" strokeWidth={font * 0.08} />
          <rect x={pattern.activeStart} y={-circ} width={Math.max(0.05, pattern.activeEnd - pattern.activeStart)} height={circ} className="active" />
          {ticks}
          {holes.map((h, i) => (
            <circle
              key={`h${i}`}
              cx={h.z}
              cy={-h.u}
              r={h.diameter / 2}
              className="cut"
              fill="none"
            >
              <title>{`Tip cross-pin hole Ø${h.diameter.toFixed(2)} mm · 180° opening`}</title>
            </circle>
          ))}
          {rects.map((r, i) => {
            const y0 = -Math.min(circ, r.u1);
            const h = Math.min(circ, r.u1) - Math.max(0, r.u0);
            if (h <= 0) return null;
            return (
              <rect
                key={i}
                x={r.z0}
                y={y0}
                width={Math.max(0.03, r.z1 - r.z0)}
                height={Math.max(0.03, h)}
                className={r.kind === 'notch' ? 'cut' : 'tx'}
              >
                <title>{`${r.kind === 'notch' ? 'Active notch' : 'Transmission slot'} · z ${r.z0.toFixed(2)}–${r.z1.toFixed(2)} mm`}</title>
              </rect>
            );
          })}
          <text x={zStart} y={-circ - circ * 0.15} className="dim-text" style={{ fontSize: font * 1.2, fontWeight: 700, fill: '#0f172a' }}>
            {cfg.name} · {tube} tube · unrolled pattern (rotated 90°)
          </text>
          <text x={zEnd} y={-circ - circ * 0.15} className="dim-text" style={{ fontSize: font * 0.85, fill: '#64748b' }} textAnchor="end">
            ⌀{(pattern.radius * 2).toFixed(2)} mm · circumference {circ.toFixed(1)} mm · {cfg.cutType} notches
          </text>
          <text x={zStart} y={-circ - circ * 0.035} className="dim-text" style={{ fontSize: font * 0.8, fill: '#e11d48' }}>cut</text>
          <text x={zEnd} y={-circ - circ * 0.035} className="dim-text" style={{ fontSize: font * 0.8, fill: '#64748b' }} textAnchor="end">
            active section {pattern.activeStart.toFixed(0)}–{pattern.activeEnd.toFixed(0)} mm
          </text>
        </svg>
      </div>
      <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--border)', background: '#fff', padding: '10px 14px', display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center', fontSize: 11 }}>
        <span className="flex gap6"><Icon name="ruler" className="sm" /> <b>{pattern.regions.length}</b> cut outlines{pattern.holes.length > 0 ? ` · ${pattern.holes.length} pin holes` : ''}{!fullLength && pattern.regions.length !== pattern.regions.filter((r) => r.kind === 'notch').length ? ` (${pattern.regions.length - pattern.regions.filter((r) => r.kind === 'notch').length} transmission hidden in this crop)` : ''}</span>
        <span className="muted">
          transmission: <b>{cfg.transmission.pattern}</b>
          {meta.segments ? ` · ${meta.segments} segments` : ''}
          {meta.slotsPerRev ? ` · ${meta.slotsPerRev} slots/rev @ ${meta.slotAngleDeg?.toFixed(0)}°` : ''}
          {meta.postDeg ? ` · posts ${meta.postDeg.toFixed(0)}°` : ''}
          {meta.bridgeDeg ? ` · bridges ${meta.bridgeDeg.toFixed(0)}°` : ''}
          {meta.gap ? ` · gap ${meta.gap.toFixed(2)} mm` : ''}
        </span>
        {meta.achievableCurvature > 0 && <span className="muted">allows κ ≈ <b>{(meta.achievableCurvature * 1000).toFixed(1)} 1/m</b></span>}
        {meta.minFeature !== undefined && meta.minFeature > 0 && (
          <span className={meta.minFeature < 0.4 && cfg.cutType === 'chord' ? 'chip warn' : 'chip gray'} title="Smallest solid feature in the transmission pattern. FDM printers typically need ≥0.4 mm; laser kerf can be much smaller.">
            min feature {meta.minFeature.toFixed(2)} mm
          </span>
        )}
        <span className="grow" />
        <span className="faint">1 unit = 1 mm · export is in standard orientation</span>
      </div>
      {pattern.notes.length > 0 && (
        <div className="callout info" style={{ margin: '0 14px 12px', fontSize: 11 }}>
          {pattern.notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}
      {!includeTx && cfg.transmission.length > 0 && (
        <div className="callout" style={{ margin: '0 14px 12px', fontSize: 11 }}>
          Transmission pattern hidden for legibility. The exported SVG/DXF always includes the full {cfg.transmission.length.toFixed(0)} mm pattern
          ({layout.panels.length} tube{layout.panels.length === 1 ? '' : 's'}).
        </div>
      )}
    </div>
  );
}
