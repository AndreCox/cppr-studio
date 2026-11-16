import { useMemo } from 'react';
import type { Project, RobotResult, SegmentConfig, SegmentResult } from '../core/types';
import { Icon, fmt } from './ui';

type Tab = 'notches' | 'charts' | 'diagnostics';

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  cfg: SegmentConfig;
  res: SegmentResult | undefined;
  project: Project;
  result: RobotResult;
  selectedNotch: number;
  onSelectNotch: (i: number) => void;
  open: boolean;
  onToggleOpen: () => void;
  height: number;
}

function utilColour(u: number): string {
  if (u > 1) return '#ef4444';
  if (u > 0.85) return '#f59e0b';
  return '#10b981';
}

export function BottomPanel(props: Props) {
  const { tab, onTab, cfg, res, project, result, selectedNotch, onSelectNotch, open, onToggleOpen, height } = props;
  return (
    <div className="bottom-panel" style={{ height: open ? height : 38 }}>
      <div className="bottom-head">
        <button type="button" className={`bottom-tab ${tab === 'notches' ? 'on' : ''}`} onClick={() => { onTab('notches'); if (!open) onToggleOpen(); }}>
          <Icon name="table" className="sm" /> Notch schedule
        </button>
        <button type="button" className={`bottom-tab ${tab === 'charts' ? 'on' : ''}`} onClick={() => { onTab('charts'); if (!open) onToggleOpen(); }}>
          <Icon name="chart" className="sm" /> Charts
        </button>
        <button type="button" className={`bottom-tab ${tab === 'diagnostics' ? 'on' : ''}`} onClick={() => { onTab('diagnostics'); if (!open) onToggleOpen(); }}>
          <Icon name="alert" className="sm" /> Diagnostics
          {(result.errors.length + result.warnings.length) > 0 && (
            <span className="chip warn" style={{ height: 16, padding: '0 5px', fontSize: 9 }}>{result.errors.length + result.warnings.length}</span>
          )}
        </button>
        <div className="grow" />
        {res && (
          <span className="tiny faint" style={{ marginRight: 8 }}>
            {res.notches.length} notches · q<sub>design</sub> {res.qDesign.toFixed(2)} mm · τ {res.tauDesign.toFixed(1)} N
          </span>
        )}
        <button type="button" className="btn ghost icon sm" aria-label={open ? 'Collapse panel' : 'Expand panel'} onClick={onToggleOpen}>
          <Icon name={open ? 'chevronDown' : 'chevronUp'} className="sm" />
        </button>
      </div>
      {open && (
        <div className="bottom-body">
          {!res ? (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <div className="big">The notch schedule will appear here</div>
              <p>Complete the segment parameters to generate a design.</p>
            </div>
          ) : tab === 'notches' ? (
            <NotchTable res={res} selected={selectedNotch} onSelect={onSelectNotch} />
          ) : tab === 'charts' ? (
            <Charts res={res} cfg={cfg} />
          ) : (
            <Diagnostics res={res} project={project} result={result} cfg={cfg} />
          )}
        </div>
      )}
    </div>
  );
}

function NotchTable({ res, selected, onSelect }: { res: SegmentResult; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            <th>#</th>
            <th className="num">z (mm)</th>
            <th className="num">h</th>
            <th className="num">l</th>
            <th className="num">g<sub>o</sub></th>
            <th className="num">g<sub>i</sub></th>
            <th className="num">γ̄<sub>o</sub></th>
            <th>φ<sub>o</sub></th>
            <th className="num">κ (1/m)</th>
            <th className="num">EI<sub>o</sub> (N mm² ×10³)</th>
            <th className="num">EI<sub>i</sub> ×10³</th>
            <th className="num">strain</th>
            <th>utilisation</th>
            <th>flags</th>
          </tr>
        </thead>
        <tbody>
          {res.notches.map((n) => (
            <tr key={n.index} className={n.index === selected ? 'sel' : ''} onClick={() => onSelect(n.index)} style={{ cursor: 'pointer' }}>
              <td style={{ fontWeight: 600 }}>{n.index + 1}</td>
              <td className="num">{n.zCenter.toFixed(2)}</td>
              <td className="num">{n.h.toFixed(2)}</td>
              <td className="num">{n.l.toFixed(2)}</td>
              <td className="num">{n.gOuter.toFixed(3)}</td>
              <td className="num">{n.gInner.toFixed(3)}</td>
              <td className="num">{n.gammaOuter.toFixed(3)}</td>
              <td>{n.phiOuter === 0 ? '0°' : '180°'}</td>
              <td className="num">{(n.kappaTarget * 1000).toFixed(1)}</td>
              <td className="num">{(n.EIOuter / 1000).toFixed(1)}</td>
              <td className="num">{(n.EIInner / 1000).toFixed(1)}</td>
              <td className="num">{(n.strainMax * 100).toFixed(2)}%</td>
              <td style={{ minWidth: 120 }}>
                <div className="flex gap6">
                  <div style={{ flex: 1, height: 6, borderRadius: 4, background: '#eef2f7', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, n.strainUtilisation * 100)}%`, height: '100%', background: utilColour(n.strainUtilisation) }} />
                  </div>
                  <span className="tiny mono" style={{ width: 34, textAlign: 'right' }}>{(n.strainUtilisation * 100).toFixed(0)}%</span>
                </div>
              </td>
              <td>
                <div className="flex gap4">
                  {n.depthCapped && <span className="chip warn" style={{ height: 17, fontSize: 9, padding: '0 5px' }}>capped</span>}
                  {n.EIUnmatched && <span className="chip warn" style={{ height: 17, fontSize: 9, padding: '0 5px' }}>EI</span>}
                  {n.bucklingRatio > 1 && <span className="chip err" style={{ height: 17, fontSize: 9, padding: '0 5px' }}>buckle</span>}
                  {!n.depthCapped && !n.EIUnmatched && n.bucklingRatio <= 1 && <span className="faint tiny">ok</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceDomain(values: number[]) {
  let lo = Math.min(...values, 0);
  let hi = Math.max(...values, 0);
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1] as const;
  if (hi === lo) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad] as const;
}

function MiniChart({
  title, x, y, bars, xLabel, yLabel, color = '#2563eb', limit, limitLabel,
}: {
  title: string;
  x?: number[];
  y?: number[];
  bars?: { x: number; y: number; color?: string }[];
  xLabel?: string;
  yLabel?: string;
  color?: string;
  limit?: number;
  limitLabel?: string;
}) {
  const W = 330;
  const H = 132;
  const m = { l: 34, r: 8, t: 8, b: 22 };
  const xs = bars ? bars.map((b) => b.x) : x ?? [];
  const ys = bars ? bars.map((b) => b.y) : y ?? [];
  const allX = xs.length ? xs : [0, 1];
  const allY = ys.length ? ys : [0, 1];
  if (limit !== undefined) allY.push(limit);
  const [x0, x1] = niceDomain(allX);
  const [y0, y1] = niceDomain(allY);
  const px = (v: number) => m.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * (W - m.l - m.r);
  const py = (v: number) => H - m.b - ((v - y0) / Math.max(1e-9, y1 - y0)) * (H - m.t - m.b);
  const line = x && y ? x.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(v).toFixed(2)} ${py(y[i]).toFixed(2)}`).join(' ') : '';
  const zero = y0 < 0 && y1 > 0;
  const ticks = [y0, (y0 + y1) / 2, y1];
  return (
    <div className="chart-card">
      <h4><span>{title}</span><span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>{yLabel}</span></h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={m.l} y1={py(t)} x2={W - m.r} y2={py(t)} className="grid" />
            <text x={m.l - 4} y={py(t) + 2} textAnchor="end" className="txt">{Math.abs(t) >= 100 ? t.toFixed(0) : t.toFixed(1)}</text>
          </g>
        ))}
        <line x1={m.l} y1={H - m.b} x2={W - m.r} y2={H - m.b} className="axis" />
        <line x1={m.l} y1={m.t} x2={m.l} y2={H - m.b} className="axis" />
        {zero && <line x1={m.l} y1={py(0)} x2={W - m.r} y2={py(0)} className="zero" />}
        {bars && bars.map((b, i) => {
          const bw = Math.max(1.5, (W - m.l - m.r) / Math.max(1, bars.length) * 0.62);
          return <rect key={i} x={px(b.x) - bw / 2} y={py(Math.max(0, b.y))} width={bw} height={Math.max(1, Math.abs(py(b.y) - py(0)))} className="bar" style={{ fill: b.color ?? '#93c5fd' }} />;
        })}
        {line && <path d={line} className="line" stroke={color} />}
        {limit !== undefined && (
          <g>
            <line x1={m.l} y1={py(limit)} x2={W - m.r} y2={py(limit)} stroke="#ef4444" strokeWidth={0.8} strokeDasharray="3 2" />
            <text x={W - m.r - 2} y={py(limit) - 3} textAnchor="end" className="txt" fill="#ef4444">{limitLabel ?? 'limit'}</text>
          </g>
        )}
        <text x={(m.l + W - m.r) / 2} y={H - 5} textAnchor="middle" className="txt">{xLabel}</text>
      </svg>
    </div>
  );
}

function Charts({ res, cfg }: { res: SegmentResult; cfg: SegmentConfig }) {
  const curved = useMemo(() => res.desiredKappa.filter((_, i) => i % 2 === 0), [res]);
  if (res.notches.length === 0) {
    return <div className="empty-state" style={{ minHeight: 140 }}><div className="big">No notch schedule</div><p>Fix the design errors to see the curvature, strain and actuation charts.</p></div>;
  }
  const sweep = res.sweep.filter((s) => s.converged);
  return (
    <div className="charts">
      <MiniChart
        title="Centreline curvature" x={curved.map((p) => p.s)} y={curved.map((p) => p.kappa * 1000)}
        xLabel="arc length s (mm)" yLabel="κ (1/m)" color="#2563eb"
      />
      <MiniChart
        title="Notch strain utilisation"
        bars={res.notches.map((n) => ({ x: n.index + 1, y: n.strainUtilisation, color: utilColour(n.strainUtilisation) }))}
        xLabel="notch #" yLabel="utilisation" limit={1} limitLabel="allowable"
      />
      <MiniChart
        title="Notch depths"
        bars={res.notches.flatMap((n) => [
          { x: n.index + 2, y: n.gOuter, color: '#60a5fa' },
          { x: n.index + 2.35, y: n.gInner, color: '#fb923c' },
        ])}
        xLabel="notch # (blue outer · orange inner)" yLabel="mm"
      />
      <MiniChart
        title="Actuation response"
        x={sweep.map((s) => s.q)} y={sweep.map((s) => (s.tip.psi * 180) / Math.PI)}
        xLabel="q (mm)" yLabel="tip angle (°)" color="#0d9488"
      />
      <MiniChart
        title="Peak strain vs actuation"
        x={sweep.map((s) => s.q)} y={sweep.map((s) => s.maxStrain * 100)}
        xLabel="q (mm)" yLabel="% strain" color="#dc2626"
      />
      <div className="chart-card">
        <h4><span>Design envelope</span></h4>
        <div className="tiny muted" style={{ lineHeight: 1.7 }}>
          <div>Target peak curvature <b>{fmt.kappa(Math.max(...res.notches.map((n) => Math.abs(n.kappaTarget))))}</b></div>
          <div>Capacity <b>{res.kappaCapacity ? fmt.kappa(res.kappaCapacity) : '—'}</b> {res.kappaCapacity ? `(min radius ${(1 / res.kappaCapacity).toFixed(1)} mm)` : ''}</div>
          <div>Actuation to target <b>{fmt.mm(res.qDesign, 2)}</b> at <b>{res.tauDesign.toFixed(1)} N</b></div>
          <div>Shape fit RMS <b>{fmt.pct(res.rmsError, 2)}</b> of L</div>
          <div>β = {cfg.beta.toFixed(2)} · c = {res.notches[0]?.c.toFixed(2)} mm · l = {res.notches[0]?.l.toFixed(2)} mm</div>
        </div>
      </div>
    </div>
  );
}

function Diagnostics({ res, project, result, cfg }: { res: SegmentResult; project: Project; result: RobotResult; cfg: SegmentConfig }) {
  const items: { tone: 'err' | 'warn' | 'info' | 'ok'; title: string; text: string }[] = [];
  for (const e of res.errors) items.push({ tone: 'err', title: 'Design error', text: e });
  for (const w of res.warnings) items.push({ tone: 'warn', title: 'Warning', text: w });
  for (const i of res.info) items.push({ tone: 'info', title: 'Note', text: i });
  for (const e of result.errors) if (!e.startsWith(`${cfg.name}:`)) items.push({ tone: 'err', title: 'Robot error', text: e });
  for (const w of result.warnings) if (!w.startsWith(`${cfg.name}:`)) items.push({ tone: 'warn', title: 'Robot warning', text: w });

  const util = res.notches.length ? Math.max(...res.notches.map((n) => n.strainUtilisation)) : 0;
  if (util < 0.7 && res.notches.length) {
    items.push({
      tone: 'info',
      title: 'Stiffness-limited design',
      text: `Peak strain utilisation is only ${(util * 100).toFixed(0)}%. The hinge depths are set by the stiffness/force trade-off; a shorter bend radius would use more of the strain budget and reduce actuation force.`,
    });
  }
  if (res.rmsError > 0.03) {
    items.push({
      tone: 'warn',
      title: 'Shape fit could improve',
      text: `${(res.rmsError * 100).toFixed(1)}% RMS error. Increase the notch count (finer discretisation) or reduce β so the bending covers more of the centreline.`,
    });
  }
  if (res.notches.some((n) => n.depthCapped)) {
    items.push({
      tone: 'warn',
      title: 'Depth cap reached',
      text: 'At least one notch cannot reach its compliance target. Reduce the bend, reduce the minimum backbone, or choose a lower-modulus / higher-strain tube.',
    });
  }
  if (res.notches.some((n) => n.bucklingRatio > 1)) {
    items.push({
      tone: 'warn',
      title: 'Buckling risk',
      text: 'The Euler buckling length is shorter than h for at least one notch. Increase the notch count or reduce the actuation force.',
    });
  }
  if (cfg.transmission.pattern !== 'solid') {
    items.push({
      tone: 'info',
      title: 'Transmission pattern',
      text: `The transmission is patterned (${cfg.transmission.pattern}). Verify its achievable curvature against the bend it must follow, and prototype the pair to check friction.`,
    });
  }
  if (items.length === 0 || items.every((i) => i.tone === 'ok')) {
    items.unshift({ tone: 'ok', title: 'No issues detected', text: 'The segment meets the model strain, depth, buckling and fit checks. Fabricate a prototype to validate friction and tolerances.' });
  }
  return (
    <div className="diag">
      {items.map((it, i) => (
        <div key={i} className={`diag-item ${it.tone}`}>
          <span className="ico">
            <Icon name={it.tone === 'err' ? 'error' : it.tone === 'warn' ? 'alert' : it.tone === 'info' ? 'info' : 'checkCircle'} className="sm" />
          </span>
          <div>
            <div style={{ fontWeight: 650 }}>{it.title}</div>
            <div className="muted">{it.text}</div>
          </div>
        </div>
      ))}
      <div className="tiny faint" style={{ padding: '4px 2px' }}>
        Data source: {project.segments.length} configured segment{project.segments.length === 1 ? '' : 's'} · model from Oliver-Butler et al. (2022). Friction, clearance and manufacturing tolerances are not included in these numbers.
      </div>
    </div>
  );
}
