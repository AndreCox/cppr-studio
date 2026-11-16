import { useMemo, useState } from 'react';
import type { SegmentConfig, SegmentResult } from '../core/types';
import { sectionProps, sectionLoops } from '../core/geometry/section';
import { IconButton, fmt } from './ui';

interface Props {
  cfg: SegmentConfig;
  res: SegmentResult | undefined;
  notchIndex: number;
  onSelectNotch: (i: number) => void;
}

const pathOf = (pts: { x: number; y: number }[], rot: number, scale = 1): string => {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  return pts
    .map((p, i) => {
      const x = (p.x * ca - p.y * sa) * scale;
      const y = (p.x * sa + p.y * ca) * scale;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(4)} ${(-y).toFixed(4)}`;
    })
    .join(' ') + ' Z';
};

export function CrossSectionView({ cfg, res, notchIndex, onSelectNotch }: Props) {
  const [showInner, setShowInner] = useState(true);
  const notch = res?.notches[Math.min(notchIndex, (res?.notches.length ?? 1) - 1)];
  const R = cfg.outerTube.od / 2;
  const rIn = cfg.innerTube.od / 2;

  const data = useMemo(() => {
    if (!notch) return null;
    const outerGeom = { od: cfg.outerTube.od, id: cfg.outerTube.od - 2 * cfg.outerTube.wall };
    const innerGeom = { od: cfg.innerTube.od, id: cfg.innerTube.od - 2 * cfg.innerTube.wall };
    const secO = sectionProps(outerGeom, cfg.cutType, notch.gOuter);
    const secI = sectionProps(innerGeom, cfg.cutType, notch.gInner);
    const rotO = notch.phiOuter - Math.PI;
    const rotI = notch.phiInner - Math.PI;
    const loopsO = sectionLoops(outerGeom, cfg.cutType, notch.gOuter, 140);
    const loopsI = sectionLoops(innerGeom, cfg.cutType, notch.gInner, 140);
    return { secO, secI, rotO, rotI, loopsO, loopsI, outerGeom, innerGeom };
  }, [cfg, notch]);

  if (!res || !notch || !data) {
    return (
      <div className="empty-state">
        <div className="big">No section to show</div>
        <p>Design the segment to inspect its notched cross-section.</p>
      </div>
    );
  }

  const { secO, secI, rotO, rotI, loopsO, loopsI } = data;
  const rotate = (p: { x: number; y: number }, rot: number) => ({
    x: p.x * Math.cos(rot) - p.y * Math.sin(rot),
    y: p.x * Math.sin(rot) + p.y * Math.cos(rot),
  });
  const outerPath = loopsO.map((l) => pathOf(l.points, rotO)).join(' ');
  const innerPath = loopsI.map((l) => pathOf(l.points, rotI)).join(' ');

  const scaleView = R * 1.35;
  const font = R * 0.095;
  const small = R * 0.075;

  const xbarO = rotate({ x: secO.xbar, y: 0 }, rotO);
  const xbarI = rotate({ x: secI.xbar, y: 0 }, rotI);
  const cutCorner = rotate({ x: secO.xMax, y: Math.sqrt(Math.max(0, R * R - secO.xMax * secO.xMax)) }, rotO);
  const backCorner = rotate({ x: -R * 0.995, y: 0 }, rotO);
  const innerCutCorner = rotate({ x: secI.xMax, y: Math.sqrt(Math.max(0, rIn * rIn - secI.xMax * secI.xMax)) }, rotI);
  const innerBackCorner = rotate({ x: -rIn * 0.995, y: 0 }, rotI);

  const positive = notch.kappaTarget >= 0;
  const tension = '#dc2626';
  const compression = '#2563eb';
  const edgeMarkers = [
    { p: backCorner, colour: positive ? tension : compression, label: 'a' },
    { p: cutCorner, colour: positive ? compression : tension, label: 'b' },
    { p: innerBackCorner, colour: positive ? compression : tension, label: "a'" },
    { p: innerCutCorner, colour: positive ? tension : compression, label: "b'" },
  ];

  return (
    <div className="section-wrap">
      <div style={{ flex: 1, minWidth: 0, position: 'relative', background: '#fbfdff' }}>
        <svg className="section-svg" viewBox={`${-scaleView} ${-scaleView} ${scaleView * 2} ${scaleView * 2}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="hatch" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="0.5" stroke="#cbd5e1" strokeWidth="0.08" />
            </pattern>
          </defs>
          {/* axes and reference circles */}
          {[R, cfg.outerTube.od / 2 - cfg.outerTube.wall, rIn, cfg.innerTube.od / 2 - cfg.innerTube.wall].map((rad, i) => (
            <circle key={i} cx={0} cy={0} r={rad} fill="none" stroke="#cbd5e1" strokeWidth={0.035} strokeDasharray={i % 2 ? '0.18 0.14' : '0.3 0.2'} opacity={0.8} />
          ))}
          <line x1={-scaleView} y1={0} x2={scaleView} y2={0} stroke="#e2e8f0" strokeWidth={0.06} />
          <line x1={0} y1={-scaleView} x2={0} y2={scaleView} stroke="#e2e8f0" strokeWidth={0.06} />
          <circle cx={0} cy={0} r={R * 0.025} fill="#94a3b8" />
          {showInner && <path d={innerPath} className="tube-fill inner" fillRule="evenodd" />}
          <path d={outerPath} className="tube-fill" fillRule="evenodd" />
          {/* neutral axes */}
          <line x1={xbarO.x} y1={-R} x2={xbarO.x} y2={R} className="na" vectorEffect="non-scaling-stroke" />
          {showInner && <line x1={xbarI.x} y1={-rIn} x2={xbarI.x} y2={rIn} className="na" style={{ opacity: 0.55 }} vectorEffect="non-scaling-stroke" />}
          {/* strain edge markers */}
          {edgeMarkers.map((m, i) => (
            <g key={`e${i}`}>
              <circle cx={m.p.x} cy={-m.p.y} r={R * 0.055} fill={m.colour} opacity={0.9} />
              <text x={m.p.x + R * 0.09} y={-m.p.y - R * 0.06} className="dim-text" style={{ fontSize: small, fill: m.colour, fontWeight: 600 }}>{m.label}</text>
            </g>
          ))}
          {/* gamma dimension */}
          <line x1={0} y1={R * 0.82} x2={xbarO.x} y2={R * 0.82} className="dim" />
          <text x={xbarO.x / 2} y={R * 0.75} textAnchor="middle" className="dim-text strong" style={{ fontSize: small }}>γ̄o {secO.gamma.toFixed(2)}</text>
          <line x1={0} y1={R * 0.93} x2={xbarI.x} y2={R * 0.93} className="dim" />
          <text x={xbarI.x / 2} y={R * 1.03} textAnchor="middle" className="dim-text" style={{ fontSize: small }}>γ̄i {secI.gamma.toFixed(2)}</text>
          {/* OD dimension */}
          <line x1={-R * 0.55} y1={R * 1.12} x2={R * 0.55} y2={R * 1.12} className="dim" />
          <text x={0} y={R * 1.22} textAnchor="middle" className="dim-text" style={{ fontSize: small }}>⌀{cfg.outerTube.od.toFixed(2)} outer · ⌀{cfg.innerTube.od.toFixed(2)} inner</text>
          <text x={-scaleView * 0.94} y={-scaleView * 0.9} className="dim-text" style={{ fontSize: font, fontWeight: 600, fill: '#0f172a' }}>notch {notch.index + 1}</text>
          <text x={-scaleView * 0.94} y={-scaleView * 0.82} className="dim-text" style={{ fontSize: small }}>
            {cfg.cutType === 'chord' ? 'chord cut (print/mill)' : 'radial cut (laser)'} · h {notch.h.toFixed(2)} mm
          </text>
        </svg>
        <div className="view-note">
          <div className="legend">
            <span><span className="swatch" style={{ background: '#dc2626' }} />tension edge</span>
            <span><span className="swatch" style={{ background: '#2563eb' }} />compression edge</span>
            <span><span className="swatch dash" style={{ color: '#e11d48' }} />neutral axis</span>
          </div>
          <div className="grow" />
          <IconButton icon="chevronLeft" label="Previous notch" size="sm" onClick={() => onSelectNotch(Math.max(0, notchIndex - 1))} />
          <span className="mono tiny">{notch.index + 1} / {res.notches.length}</span>
          <IconButton icon="chevronRight" label="Next notch" size="sm" onClick={() => onSelectNotch(Math.min(res.notches.length - 1, notchIndex + 1))} />
        </div>
      </div>
      <div className="section-side">
        <div className="panel-title" style={{ marginBottom: 8 }}>Notch pair {notch.index + 1}</div>
        <div className="metric-grid">
          <div className="metric"><div className="v">{notch.gOuter.toFixed(2)}</div><div className="l">g outer (mm)</div></div>
          <div className="metric"><div className="v">{notch.gInner.toFixed(2)}</div><div className="l">g inner (mm)</div></div>
          <div className="metric"><div className="v">{notch.h.toFixed(2)}</div><div className="l">h (mm)</div></div>
          <div className="metric"><div className="v">{notch.l.toFixed(2)}</div><div className="l">l (mm)</div></div>
          <div className="metric"><div className="v">{fmt.kappa(notch.kappaTarget)}</div><div className="l">κ target</div></div>
          <div className="metric"><div className="v">{fmt.pct(notch.strainMax, 2)}</div><div className="l">max strain</div></div>
        </div>
        <div style={{ height: 10 }} />
        <div className="tiny muted" style={{ lineHeight: 1.6 }}>
          <div><b>Neutral axis offsets</b> γ̄o = {secO.gamma.toFixed(3)} mm · γ̄i = {secI.gamma.toFixed(3)} mm · d = {Math.abs(notch.d).toFixed(3)} mm</div>
          <div><b>Second moments</b> Io = {secO.Iyy.toExponential(2)} mm⁴ · Ii = {secI.Iyy.toExponential(2)} mm⁴</div>
          <div><b>Flexural rigidity</b> EI o = {(notch.EIOuter / 1000).toFixed(2)} · EI i = {(notch.EIInner / 1000).toFixed(2)} N·mm² ×10³</div>
          <div><b>Remaining material</b> outer {secO.remainingWidth.toFixed(3)} mm · inner {secI.remainingWidth.toFixed(3)} mm</div>
        </div>
        <div style={{ height: 10 }} />
        <div className={`callout ${notch.strainUtilisation > 1 ? 'err' : notch.strainUtilisation > 0.85 ? 'warn' : 'ok'}`}>
          <b>Strain utilisation {(notch.strainUtilisation * 100).toFixed(0)}%</b> of the allowable.
          <div className="tiny" style={{ marginTop: 4 }}>
            outer a {fmt.pct(notch.strainOuterBackbone, 2)} · b {fmt.pct(notch.strainOuterCut, 2)}<br />
            inner a {fmt.pct(notch.strainInnerBackbone, 2)} · b {fmt.pct(notch.strainInnerCut, 2)}
          </div>
        </div>
        <div style={{ height: 8 }} />
        <div className="callout">
          The asymmetric cut shifts the neutral axis toward the remaining backbone. Push–pull on the two tubes then produces a bending moment — the offset is the moment arm.
        </div>
        <div style={{ marginTop: 10 }}>
          <label className="toggle">
            <input type="checkbox" checked={showInner} onChange={(e) => setShowInner(e.target.checked)} />
            <span>Show inner tube</span>
          </label>
        </div>
      </div>
    </div>
  );
}
