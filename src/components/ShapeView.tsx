import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActuationState, SegmentConfig, SegmentResult } from '../core/types';
import { compileDesiredCurve, distanceToPolyline, waypointFrame } from '../core/geometry/curve';
import { IconButton, fmt } from './ui';

interface ViewBox { x: number; y: number; w: number; h: number }

interface Props {
  cfg: SegmentConfig;
  res: SegmentResult | undefined;
  fraction: number;
  notchIndex: number;
  onSelectNotch: (i: number) => void;
  onWaypoints: (pts: { x: number; z: number }[]) => void;
  showFan: boolean;
  colourByStrain: boolean;
}

function niceStep(target: number): number {
  if (!(target > 1e-6)) return 1;
  const exp = Math.floor(Math.log10(target));
  const base = Math.pow(10, exp);
  const f = target / base;
  const mult = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return mult * base;
}

function strainColour(util: number): string {
  const t = Math.max(0, Math.min(1, util));
  if (t < 0.6) {
    const u = t / 0.6;
    return `rgb(${Math.round(34 + (234 - 34) * u)}, ${Math.round(197 + (179 - 197) * u)}, ${Math.round(94 + (8 - 94) * u)})`;
  }
  const u = (t - 0.6) / 0.4;
  return `rgb(${Math.round(234 + (239 - 234) * u)}, ${Math.round(179 + (68 - 179) * u)}, ${Math.round(8 + (68 - 8) * u)})`;
}

function pickNearest(res: SegmentResult, fraction: number): ActuationState | null {
  if (!res.sweep.length) return res.designState;
  const target = fraction * res.qDesign;
  let best = res.designState ?? res.sweep[0];
  let bestD = best ? Math.abs(best.q - target) : Infinity;
  for (const st of res.sweep) {
    if (!st.converged) continue;
    const d = Math.abs(st.q - target);
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
}

export function ShapeView(props: Props) {
  const { cfg, res, fraction, notchIndex, onSelectNotch, onWaypoints, showFan, colourByStrain } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState<ViewBox>({ x: -20, y: -60, w: 80, h: 70 });
  const [dragging, setDragging] = useState<'pan' | 'handle' | null>(null);
  const dragRef = useRef<{ pointer: { x: number; y: number }; model: { x: number; z: number }; idx?: number; offset?: { x: number; z: number }; frame?: ReturnType<typeof waypointFrame> } | null>(null);
  const [hoverNotch, setHoverNotch] = useState<number | null>(null);
  const lastFit = useRef<string>('');

  const curve = useMemo(() => compileDesiredCurve(cfg.shape, cfg.activeLength), [cfg.shape, cfg.activeLength]);
  const state = res ? pickNearest(res, fraction) : null;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const pts: { x: number; z: number }[] = [];
    for (const p of curve.samples) pts.push(p);
    if (res?.designState) for (const p of res.designState.shape) pts.push(p);
    if (!pts.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const dx = Math.max(2, maxX - minX);
    const dz = Math.max(2, maxZ - minZ);
    const pad = Math.max(dx, dz) * 0.09 + 2;
    let w = dx + 2 * pad;
    let h = dz + 2 * pad;
    const aspect = size.w / Math.max(1, size.h);
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    setView({ x: cx - w / 2, y: -cz - h / 2, w, h });
  }, [curve, res, size.w, size.h]);

  useEffect(() => {
    const key = `${cfg.id}:${cfg.shape.kind}:${cfg.shape.kind === 'preset' ? cfg.shape.preset : ''}:${res ? 'r' : 'n'}`;
    if (lastFit.current !== key && size.w > 20) {
      lastFit.current = key;
      fit();
    }
  }, [cfg.id, res, size.w, fit]);

  const toModel = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, z: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, z: -p.y };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = (view.w / size.w);
    const factor = Math.exp(e.deltaY * 0.0012);
    const nw = Math.max(2, Math.min(4000, view.w * factor));
    const nh = nw * (view.h / view.w);
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    setView((v) => ({
      x: v.x + fx * v.w - fx * nw,
      y: v.y + fy * v.h - fy * nh,
      w: nw,
      h: nh,
    }));
    void scale;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const model = toModel(e.clientX, e.clientY);
    if (cfg.shape.kind === 'waypoints') {
      const frame = waypointFrame(cfg.shape, cfg.activeLength);
      const tol = view.w * 0.014;
      for (let i = 1; i < frame.points.length; i++) {
        const p = frame.points[i];
        if (Math.hypot(p.x - model.x, p.z - model.z) < tol) {
          dragRef.current = { pointer: { x: e.clientX, y: e.clientY }, model, idx: i, frame, offset: { x: p.x - model.x, z: p.z - model.z } };
          setDragging('handle');
          (e.target as Element).setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    dragRef.current = { pointer: { x: e.clientX, y: e.clientY }, model };
    setDragging('pan');
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const dr = dragRef.current;
    if (!dr) return;
    if (dragging === 'pan') {
      const m = toModel(e.clientX, e.clientY);
      setView((v) => ({ ...v, x: v.x + (dr.model.x - m.x), y: v.y - (dr.model.z - m.z) }));
      dr.model = m;
    } else if (dragging === 'handle' && dr.idx !== undefined && dr.frame) {
      const m = toModel(e.clientX, e.clientY);
      const target = { x: m.x + (dr.offset?.x ?? 0), z: m.z + (dr.offset?.z ?? 0) };
      const f = dr.frame;
      const rx = target.x / f.scale;
      const rz = target.z / f.scale;
      const ca = Math.cos(f.rotation);
      const sa = Math.sin(f.rotation);
      const rawX = rx * ca + rz * sa + f.origin.x;
      const rawZ = -rx * sa + rz * ca + f.origin.z;
      const next = cfg.shape.waypoints.map((p, i) => (i === dr.idx ? { x: rawX / cfg.activeLength, z: rawZ / cfg.activeLength } : p));
      onWaypoints(next);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    dragRef.current = null;
    setDragging(null);
  };

  const pathFor = (pts: { x: number; z: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${(-p.z).toFixed(3)}`).join(' ');

  const desiredPath = pathFor(curve.samples);
  const achievable = state?.shape ?? [];
  const gridStep = niceStep(view.w / 7);
  const xStart = Math.floor(view.x / gridStep) * gridStep;
  const xEnd = view.x + view.w;
  const zMin = view.y + view.h; // z = -y
  const zMax = view.y;
  const zStart = Math.floor(-zMax / gridStep) * gridStep;
  const zEnd = -zMin;
  const gridLines: React.ReactNode[] = [];
  let gi = 0;
  for (let x = xStart; x <= xEnd + 1e-9; x += gridStep) {
    const major = Math.abs(x / (gridStep * 5) - Math.round(x / (gridStep * 5))) < 1e-6;
    gridLines.push(
      <line key={`gx${gi++}`} x1={x} y1={-zEnd} x2={x} y2={-zStart} className={`grid-line ${major ? 'major' : ''}`} vectorEffect="non-scaling-stroke" />,
    );
  }
  for (let z = zStart; z <= zEnd + 1e-9; z += gridStep) {
    const major = Math.abs(z / (gridStep * 5) - Math.round(z / (gridStep * 5))) < 1e-6;
    gridLines.push(
      <line key={`gz${gi++}`} x1={xStart} y1={-z} x2={xEnd} y2={-z} className={`grid-line ${major ? 'major' : ''}`} vectorEffect="non-scaling-stroke" />,
    );
  }

  const font = Math.max(0.8, view.h * 0.017);
  const small = Math.max(0.6, view.h * 0.013);

  const notchPoints = useMemo(() => {
    if (!state) return [];
    return state.notchArcs.map((arc) => {
      const sc = 0.5 * (arc.sStart + arc.sEnd);
      let pose = state.shape[0];
      for (let i = 1; i < state.shape.length; i++) {
        if (state.shape[i].s >= sc) {
          const a = state.shape[i - 1];
          const b = state.shape[i];
          const w = (sc - a.s) / Math.max(1e-9, b.s - a.s);
          pose = { s: sc, x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w, psi: a.psi + (b.psi - a.psi) * w };
          break;
        }
      }
      return { index: arc.index, x: pose.x, z: pose.z, kappa: arc.kappa };
    });
  }, [state]);

  const currentRms = (() => {
    if (!state || state.shape.length < 2) return res?.rmsError ?? 0;
    const poly = curve.samples.map((p) => ({ x: p.x, z: p.z }));
    let sum = 0;
    for (const p of state.shape) {
      const d = distanceToPolyline(p, poly);
      sum += d * d;
    }
    return Math.sqrt(sum / state.shape.length) / Math.max(1, cfg.activeLength);
  })();

  const desiredTip = curve.poseAt(cfg.activeLength);
  const tip = state?.tip ?? desiredTip;
  const scaleLen = (() => {
    const raw = view.w * 0.18;
    const step = niceStep(raw);
    return step;
  })();
  const scaleX = view.x + view.w * 0.05;
  const scaleY = -view.y - view.h * 0.075;

  const handlePoints = cfg.shape.kind === 'waypoints' ? waypointFrame(cfg.shape, cfg.activeLength).points : [];

  const strainSegments = () => {
    if (!state || !res) return null;
    const out: React.ReactNode[] = [];
    for (let i = 1; i < state.shape.length; i++) {
      const a = state.shape[i - 1];
      const b = state.shape[i];
      const mid = (a.s + b.s) / 2;
      const arc = state.notchArcs.find((x) => mid >= x.sStart && mid <= x.sEnd);
      let color = '#94a3b8';
      if (arc) {
        const util = res.notches[arc.index]?.strainUtilisation ?? 0;
        color = strainColour(util);
      }
      out.push(
        <line
          key={`st${i}`}
          x1={a.x} y1={-a.z} x2={b.x} y2={-b.z}
          stroke={color} strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke"
        />,
      );
    }
    return out;
  };

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <svg
        ref={svgRef}
        className={`shape-svg ${dragging ? 'dragging' : ''}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('grid-line')) fit();
        }}
      >
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="#fbfdff" />
        {gridLines}
        <line x1={0} y1={-zEnd} x2={0} y2={-zStart} className="axis" vectorEffect="non-scaling-stroke" />
        <line x1={xStart} y1={0} x2={xEnd} y2={0} className="axis" vectorEffect="non-scaling-stroke" />

        {showFan && res && res.sweep.filter((s) => s.converged && Math.abs(s.q - (state?.q ?? 0)) > 1e-6).map((s, i) => (
          <path key={`fan${i}`} d={pathFor(s.shape)} className="fan" vectorEffect="non-scaling-stroke" />
        ))}

        {colourByStrain ? strainSegments() : achievable.length > 1 && (
          <path d={pathFor(achievable)} className="achieved" vectorEffect="non-scaling-stroke" />
        )}
        <path d={desiredPath} className="desired" vectorEffect="non-scaling-stroke" opacity={0.55} />

        {notchPoints.map((p) => (
          <g key={`n${p.index}`}>
            <circle
              cx={p.x}
              cy={-p.z}
              r={Math.max(0.5, view.h * 0.007)}
              className={`notch ${p.index === notchIndex ? 'on' : ''}`}
              vectorEffect="non-scaling-stroke"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectNotch(p.index);
              }}
              onMouseEnter={() => setHoverNotch(p.index)}
              onMouseLeave={() => setHoverNotch(null)}
            >
              <title>{`Notch ${p.index + 1} · κ ${(p.kappa * 1000).toFixed(1)} 1/m · g_o ${res?.notches[p.index]?.gOuter.toFixed(2)} mm · strain ${((res?.notches[p.index]?.strainMax ?? 0) * 100).toFixed(2)} %`}</title>
            </circle>
          </g>
        ))}

        {cfg.shape.kind === 'waypoints' && handlePoints.map((p, i) => (
          <circle
            key={`h${i}`}
            cx={p.x}
            cy={-p.z}
            r={Math.max(0.6, view.h * 0.009)}
            className="handle"
            vectorEffect="non-scaling-stroke"
            style={{ cursor: i === 0 ? 'default' : 'grab' }}
          >
            <title>{i === 0 ? 'Base anchor' : `Shape handle ${i}`}</title>
          </circle>
        ))}

        <circle cx={tip.x} cy={-tip.z} r={Math.max(0.5, view.h * 0.007)} className="tip" />
        <circle cx={tip.x} cy={-tip.z} r={Math.max(1.2, view.h * 0.017)} fill="none" stroke="#e11d48" strokeWidth={1} opacity={0.4} vectorEffect="non-scaling-stroke" />

        <g style={{ pointerEvents: 'none' }}>
          <line x1={scaleX} y1={scaleY} x2={scaleX + scaleLen} y2={scaleY} className="scale-bar" vectorEffect="non-scaling-stroke" />
          <line x1={scaleX} y1={scaleY - font * 0.25} x2={scaleX} y2={scaleY + font * 0.25} className="scale-bar" vectorEffect="non-scaling-stroke" />
          <line x1={scaleX + scaleLen} y1={scaleY - font * 0.25} x2={scaleX + scaleLen} y2={scaleY + font * 0.25} className="scale-bar" vectorEffect="non-scaling-stroke" />
          <text x={scaleX} y={scaleY - font * 0.6} className="label" style={{ fontSize: small }}>{scaleLen >= 10 ? scaleLen.toFixed(0) : scaleLen.toFixed(1)} mm</text>
          <text x={tip.x + view.w * 0.012} y={-tip.z - view.h * 0.012} className="label strong" style={{ fontSize: small }}>
            tip ({tip.x.toFixed(1)}, {tip.z.toFixed(1)}) mm · {((tip.psi * 180) / Math.PI).toFixed(1)}°
          </text>
          {hoverNotch !== null && (() => {
            const p = notchPoints.find((q) => q.index === hoverNotch);
            if (!p) return null;
            return (
              <text x={p.x + view.w * 0.012} y={-p.z + view.h * 0.03} className="label" style={{ fontSize: small }}>
                #{p.index + 1}
              </text>
            );
          })()}
        </g>
      </svg>

      <div className="view-overlay">
        <div className="overlay-card">
          <div className="overlay-stats">
            <div className="overlay-stat"><div className="v">{state ? fmt.mm(state.q, 2) : '—'}</div><div className="l">Actuation q</div></div>
            <div className="overlay-stat"><div className="v">{state ? `${state.tau.toFixed(1)} N` : '—'}</div><div className="l">Inner tension</div></div>
            <div className="overlay-stat"><div className="v">{state ? `${((tip.psi * 180) / Math.PI).toFixed(0)}°` : '—'}</div><div className="l">Tip angle</div></div>
            <div className="overlay-stat"><div className="v">{res ? `${(currentRms * 100).toFixed(1)}%` : '—'}</div><div className="l">Match to target</div></div>
          </div>
        </div>
        {res && res.errors.length > 0 && (
          <div className="callout err" style={{ maxWidth: 430 }}>
            <strong>Design not generated.</strong> {res.errors[0]}
          </div>
        )}
      </div>

      <div className="view-note">
        <div className="legend">
          <span><span className="swatch dash" style={{ color: '#2563eb' }} />target shape</span>
          <span><span className="swatch" style={{ background: '#0f172a' }} />model shape</span>
          {showFan && <span className="faint">ghost = actuation sweep</span>}
          {cfg.shape.kind === 'waypoints' && <span className="faint">drag the round handles to edit the shape</span>}
        </div>
        <div className="grow" />
        {colourByStrain && (
          <div className="strain-legend">
            <span>strain</span>
            <span className="strain-bar" />
            <span>0 → limit</span>
          </div>
        )}
        <IconButton icon="target" label="Fit view" size="sm" onClick={fit} />
        <IconButton icon="zoomIn" label="Zoom in" size="sm" onClick={() => setView((v) => ({ ...v, x: v.x + v.w * 0.1, y: v.y + v.h * 0.1, w: v.w * 0.8, h: v.h * 0.8 }))} />
        <IconButton icon="zoomOut" label="Zoom out" size="sm" onClick={() => setView((v) => ({ ...v, x: v.x - v.w * 0.125, y: v.y - v.h * 0.125, w: v.w * 1.25, h: v.h * 1.25 }))} />
      </div>
    </div>
  );
}
