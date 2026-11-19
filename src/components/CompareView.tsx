import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, RobotResult, SegmentConfig, SegmentResult } from '../core/types';
import {
  analyticCurve,
  curveMetrics,
  localizeSection,
  sectionFor,
  targetCurve,
  type CurvePoint,
  type CurveMetrics,
} from '../core/cosserat/compare';
import { solveCosserat, type CosseratResult } from '../core/cosserat/solver';
import { Button, Icon, Toggle } from './ui';

interface Props {
  project: Project;
  result: RobotResult;
  selected: SegmentConfig;
  res: SegmentResult | undefined;
  fraction: number;
  onFraction: (fraction: number) => void;
}

type ModelId = 'target' | 'analytic' | 'planar' | 'three';

interface ModelRow {
  id: ModelId;
  label: string;
  color: string;
  points: CurvePoint[];
  metrics: CurveMetrics | null;
  outOfPlane: number | null;
  status: string;
  solve: string;
  tone: 'reference' | 'ok' | 'warn' | 'err' | 'gray' | 'pending';
  closest: boolean;
}

const COLORS: Record<ModelId, string> = {
  target: '#94a3b8',
  analytic: '#2563eb',
  planar: '#059669',
  three: '#d97706',
};

const LABELS: Record<ModelId, string> = {
  target: 'Target',
  analytic: 'Analytic',
  planar: 'Cosserat planar',
  three: 'Cosserat 3D',
};

function niceStep(raw: number): number {
  if (!(raw > 1e-9)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const mult = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return mult * base;
}

function ticks(min: number, max: number, count = 5): number[] {
  const span = Math.max(1e-6, max - min);
  const step = niceStep(span / count);
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function pathFor(points: CurvePoint[], sx: (x: number) => number, sy: (z: number) => number): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)},${sy(p.z).toFixed(2)}`).join(' ');
}

function CompareChart({ rows, title }: { rows: ModelRow[]; title: string }) {
  const visible = rows.filter((row) => row.points.length > 1);
  const all = visible.flatMap((row) => row.points);
  if (all.length === 0) {
    return (
      <div className="compare-chart-empty">
        <Icon name="chart" size={22} />
        <span>No model curves yet. Complete the segment design to compare.</span>
      </div>
    );
  }
  const xs = all.map((p) => p.x);
  const zs = all.map((p) => p.z);
  const xMin0 = Math.min(...xs, 0);
  const xMax0 = Math.max(...xs, 0.5);
  const zMin0 = Math.min(...zs, 0);
  const zMax0 = Math.max(...zs, 0.5);
  const padX = Math.max(1, (xMax0 - xMin0) * 0.12);
  const padZ = Math.max(1, (zMax0 - zMin0) * 0.08);
  const xMin = xMin0 - padX;
  const xMax = xMax0 + padX;
  const zMin = zMin0 - padZ;
  const zMax = zMax0 + padZ;
  const W = 860;
  const H = 520;
  const M = { left: 52, right: 22, top: 26, bottom: 38 };
  const sx = (x: number) => M.left + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * (W - M.left - M.right);
  const sy = (z: number) => H - M.bottom - ((z - zMin) / Math.max(1e-6, zMax - zMin)) * (H - M.top - M.bottom);
  const xTicks = ticks(xMin, xMax, 6);
  const zTicks = ticks(zMin, zMax, 6);

  const draw = [...visible].sort((a, b) => (a.id === 'target' ? 1 : 0) - (b.id === 'target' ? 1 : 0));
  return (
    <div className="compare-chart-inner">
      <svg className="compare-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Model centerline comparison">
        <rect x={0} y={0} width={W} height={H} className="compare-chart-bg" />
        {xTicks.map((t) => (
          <line key={`gx${t}`} x1={sx(t)} y1={M.top} x2={sx(t)} y2={H - M.bottom} className="compare-grid" />
        ))}
        {zTicks.map((t) => (
          <line key={`gz${t}`} x1={M.left} y1={sy(t)} x2={W - M.right} y2={sy(t)} className="compare-grid" />
        ))}
        <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} className="compare-axis" />
        <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} className="compare-axis" />
        {xTicks.map((t) => (
          <text key={`tx${t}`} x={sx(t)} y={H - M.bottom + 16} className="compare-tick" textAnchor="middle">{t}</text>
        ))}
        {zTicks.map((t) => (
          <text key={`tz${t}`} x={M.left - 8} y={sy(t) + 3.5} className="compare-tick" textAnchor="end">{t}</text>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 8} className="compare-axis-label" textAnchor="middle">x (mm)</text>
        <text x={14} y={(M.top + H - M.bottom) / 2} className="compare-axis-label" textAnchor="middle" transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`}>z (mm)</text>
        {draw.map((row) => (
          <path
            key={row.id}
            d={pathFor(row.points, sx, sy)}
            fill="none"
            stroke={row.color}
            strokeWidth={row.id === 'target' ? 2 : 2.4}
            strokeDasharray={row.id === 'target' ? '7 5' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={row.id === 'target' ? 0.9 : 1}
          />
        ))}
        {visible.map((row) => {
          const tip = row.points[row.points.length - 1];
          return (
            <g key={`tip${row.id}`}>
              <circle cx={sx(tip.x)} cy={sy(tip.z)} r={4.5} fill={row.color} stroke="#fff" strokeWidth={1.5} />
            </g>
          );
        })}
        <text x={M.left + 10} y={M.top + 14} className="compare-chart-title">{title}</text>
      </svg>
      <div className="compare-legend">
        {rows.map((row) => (
          <div key={row.id} className={`compare-legend-item ${row.points.length > 1 ? '' : 'off'}`}>
            <span className={`compare-swatch ${row.id === 'target' ? 'dash' : ''}`} style={{ background: row.color, borderColor: row.color }} />
            <span>{LABELS[row.id]}</span>
            {row.closest && <span className="compare-closest">closest</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTip(tip: CurvePoint | null): string {
  return tip ? `${tip.x.toFixed(1)}, ${tip.z.toFixed(1)}` : '—';
}

export function CompareView({ project, result, selected, res, fraction, onFraction }: Props) {
  const [planar, setPlanar] = useState<CosseratResult | null>(null);
  const [planarPending, setPlanarPending] = useState(false);
  const [planarError, setPlanarError] = useState<string | null>(null);
  const [three, setThree] = useState<CosseratResult | null>(null);
  const [threePending, setThreePending] = useState(false);
  const [threeError, setThreeError] = useState<string | null>(null);
  const [threeGravity, setThreeGravity] = useState(false);
  const [paperCalibration, setPaperCalibration] = useState(false);
  const threeToken = useRef(0);

  useEffect(() => {
    if (!res || !result.ok) {
      setPlanar(null);
      setPlanarPending(false);
      setPlanarError(res ? 'Fix the design checks to solve the rod model.' : 'No designed segment selected.');
      return;
    }
    let cancelled = false;
    setPlanarPending(true);
    setPlanarError(null);
    const timer = window.setTimeout(() => {
      solveCosserat(project, result, { fraction, gravityEnabled: false, planar: true, onlySegmentId: selected.id, centroidScale: paperCalibration ? 1.27 : 1 })
        .then((solved) => {
          if (cancelled) return;
          setPlanar(solved);
          setPlanarPending(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPlanar(null);
          setPlanarPending(false);
          setPlanarError(error instanceof Error ? error.message : String(error));
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project, result, res, fraction, selected.id, paperCalibration]);

  useEffect(() => {
    threeToken.current += 1;
    setThree(null);
    setThreeError(null);
    setThreePending(false);
  }, [project, fraction, threeGravity, paperCalibration, selected.id]);

  const runFull3D = useCallback(() => {
    if (!res || !result.ok) return;
    const token = ++threeToken.current;
    setThreePending(true);
    setThreeError(null);
    solveCosserat(project, result, { fraction, gravityEnabled: threeGravity, planar: false, onlySegmentId: selected.id, centroidScale: paperCalibration ? 1.27 : 1 })
      .then((solved) => {
        if (token !== threeToken.current) return;
        setThree(solved);
        setThreePending(false);
      })
      .catch((error: unknown) => {
        if (token !== threeToken.current) return;
        setThree(null);
        setThreePending(false);
        setThreeError(error instanceof Error ? error.message : String(error));
      });
  }, [project, result, res, fraction, threeGravity, selected.id, paperCalibration]);

  const target = useMemo(() => (res ? targetCurve(res) : []), [res]);
  const analytic = useMemo(() => (res ? analyticCurve(res, fraction) : []), [res, fraction]);
  const planarLocal = useMemo(() => (planar ? (() => {
    const section = sectionFor(planar, selected.id);
    return section ? localizeSection(section) : null;
  })() : null), [planar, selected.id]);
  const threeLocal = useMemo(() => (three ? (() => {
    const section = sectionFor(three, selected.id);
    return section ? localizeSection(section) : null;
  })() : null), [three, selected.id]);

  const targetMetrics = useMemo(() => curveMetrics(target, target), [target]);
  const analyticMetrics = useMemo(() => curveMetrics(analytic, target), [analytic, target]);
  const planarMetrics = useMemo(() => (planarLocal ? curveMetrics(planarLocal.points, target) : null), [planarLocal, target]);
  const threeMetrics = useMemo(() => (threeLocal ? curveMetrics(threeLocal.points, target) : null), [threeLocal, target]);
  const active = Math.max(1e-6, res?.desiredShape[res.desiredShape.length - 1]?.s ?? selected.activeLength);

  const modelRms = [analyticMetrics?.rms, planarMetrics?.rms, threeMetrics?.rms].filter((value): value is number => value !== undefined && Number.isFinite(value));
  const closestRms = modelRms.length ? Math.min(...modelRms) : null;

  const rows: ModelRow[] = [];
  rows.push({
    id: 'target',
    label: LABELS.target,
    color: COLORS.target,
    points: target,
    metrics: targetMetrics,
    outOfPlane: res ? 0 : null,
    status: 'reference',
    solve: '—',
    tone: 'reference',
    closest: false,
  });
  if (analytic.length > 1) {
    rows.push({
      id: 'analytic',
      label: LABELS.analytic,
      color: COLORS.analytic,
      points: analytic,
      metrics: analyticMetrics,
      outOfPlane: 0,
      status: res ? 'sweep' : '—',
      solve: '—',
      tone: 'ok',
      closest: closestRms !== null && analyticMetrics?.rms === closestRms,
    });
  }
  if (planarLocal) {
    rows.push({
      id: 'planar',
      label: LABELS.planar,
      color: COLORS.planar,
      points: planarLocal.points,
      metrics: planarMetrics,
      outOfPlane: planarLocal.outOfPlane,
      status: planar?.converged ? 'converged' : 'best effort',
      solve: planar ? `${planar.iterations} it · ${planar.solveTimeMs.toFixed(0)} ms` : '—',
      tone: planar?.converged ? 'ok' : 'warn',
      closest: closestRms !== null && planarMetrics?.rms === closestRms,
    });
  } else {
    rows.push({
      id: 'planar',
      label: LABELS.planar,
      color: COLORS.planar,
      points: [],
      metrics: null,
      outOfPlane: null,
      status: planarPending ? 'solving…' : planarError ? 'error' : 'pending',
      solve: '—',
      tone: planarError ? 'err' : planarPending ? 'pending' : 'gray',
      closest: false,
    });
  }
  if (threeLocal) {
    rows.push({
      id: 'three',
      label: LABELS.three,
      color: COLORS.three,
      points: threeLocal.points,
      metrics: threeMetrics,
      outOfPlane: threeLocal.outOfPlane,
      status: (three?.converged ? 'converged' : 'best effort') + (threeGravity ? ' · gravity' : ''),
      solve: three ? `${three.iterations} it · ${(three.solveTimeMs / 1000).toFixed(2)} s` : '—',
      tone: three?.converged ? 'ok' : 'warn',
      closest: closestRms !== null && threeMetrics?.rms === closestRms,
    });
  } else {
    rows.push({
      id: 'three',
      label: LABELS.three,
      color: COLORS.three,
      points: [],
      metrics: null,
      outOfPlane: null,
      status: threePending ? 'solving…' : threeError ? 'error' : 'not run',
      solve: '—',
      tone: threeError ? 'err' : threePending ? 'pending' : 'gray',
      closest: false,
    });
  }

  const closestLabel = (() => {
    if (closestRms === null) return null;
    const row = rows.find((r) => r.closest);
    return row?.label ?? null;
  })();

  return (
    <div className="compare-view">
      <div className="compare-head">
        <div className="compare-title">
          <div className="compare-title-row">
            <h2>Compare models</h2>
            <span className="compare-segment">{selected.name}</span>
          </div>
          <p>
            Selected section vs the analytic notch model vs the Cosserat rod solver. Planar is automatic; full 3D is on demand.
          </p>
        </div>
        <div className="compare-actuation" title="Actuation preview for all model curves">
          <span className="lbl">Actuation</span>
          <input
            className="range"
            type="range"
            min={-0.6}
            max={1.2}
            step={0.15}
            value={fraction}
            onChange={(e) => onFraction(Number(e.target.value))}
            aria-label="Comparison actuation preview"
          />
          <span className="val">{res ? `${(res.qDesign * fraction).toFixed(2)} mm` : '—'}</span>
          <button type="button" className="btn xs ghost" onClick={() => onFraction(1)} title="Return to the design actuation">Design</button>
        </div>
        <div className="compare-actions">
          <Button size="sm" icon={three ? 'rotate' : 'play'} onClick={runFull3D} disabled={!res || !result.ok || threePending}>
            {threePending ? 'Solving full 3D…' : three ? 'Refresh full 3D' : 'Run full 3D'}
          </Button>
          <Toggle label="Gravity" checked={threeGravity} onChange={setThreeGravity} disabled={threePending} hint="Include self-weight in the on-demand full-3D solve" />
          <Toggle label="Paper fD 1.27" checked={paperCalibration} onChange={setPaperCalibration} disabled={planarPending || threePending} hint="Use the paper's printed-prototype centroid calibration factor" />
        </div>
      </div>

      <div className="compare-status-row">
        <span className={`solver-chip ${planarError ? 'error' : planarPending ? 'pending' : planar?.converged ? 'ok' : planar ? 'warn' : 'gray'}`} title={planarError ?? undefined}>
          <span className="solver-dot" />
          Planar {planarPending ? '· solving…' : planarError ? '· failed' : planar ? `· ${planar.converged ? 'converged' : 'best effort'} · ${planar.iterations} it · ${(planar.solveTimeMs / 1000).toFixed(1)} s` : '· pending'}
        </span>
        <span className={`solver-chip ${threeError ? 'error' : threePending ? 'pending' : three?.converged ? 'ok' : three ? 'warn' : 'gray'}`} title={threeError ?? undefined}>
          <span className="solver-dot" />
          3D {threePending ? '· solving…' : threeError ? '· failed' : three ? `· ${three.converged ? 'converged' : 'best effort'} · ${three.iterations} it · ${(three.solveTimeMs / 1000).toFixed(1)} s` : '· not run'}
        </span>
        {closestLabel && <span className="compare-closest-summary">Closest to target: <b>{closestLabel}</b></span>}
        {res && <span className="compare-target-meta">L {(res.desiredShape[res.desiredShape.length - 1]?.s ?? selected.activeLength).toFixed(1)} mm · {res.notches.length} notches · target tip {formatTip(target[target.length - 1] ?? null)}</span>}
      </div>

      {(planarError || threeError) && (
        <div className="compare-alert">
          <Icon name="alert" className="sm" />
          <span>{planarError ?? threeError}</span>
        </div>
      )}

      <div className="compare-chart">
        <CompareChart rows={rows} title="Centerline comparison · selected segment" />
      </div>

      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Tip x, z (mm)</th>
              <th className="num">Tip error</th>
              <th className="num">RMS</th>
              <th className="num">Out of plane</th>
              <th>Solve</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.closest ? 'closest' : ''}>
                <td>
                  <span className="compare-dot" style={{ background: row.color }} />
                  <span className="compare-model-name">{row.label}</span>
                  {row.closest && <span className="compare-closest">closest</span>}
                </td>
                <td className="num">{row.metrics ? formatTip(row.metrics.modelTip) : row.id === 'target' ? formatTip(target[target.length - 1] ?? null) : '—'}</td>
                <td className="num">{row.id === 'target' ? '—' : row.metrics ? `${row.metrics.tipError.toFixed(2)} mm (${((row.metrics.tipError / active) * 100).toFixed(1)}%)` : '—'}</td>
                <td className="num">{row.id === 'target' ? '—' : row.metrics ? `${((row.metrics.rms / active) * 100).toFixed(2)}%` : '—'}</td>
                <td className="num">{row.outOfPlane === null ? '—' : row.id === 'target' ? '—' : `${row.outOfPlane.toFixed(2)} mm`}</td>
                <td className="compare-solve">{row.solve}</td>
                <td><span className={`compare-status ${row.tone}`}>{row.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="compare-note">
          <b>Target</b> is the designed centreline. <b>Analytic</b> uses the fast notch model at the selected fraction.
          <b> Cosserat planar</b> is the paper's 2D rod reduction over the designed notch depths; <b>full 3D</b> adds
          out-of-plane deformation and optional gravity. Both Cosserat rows solve the selected section on its own; the 3D robot
          view solves the assembled chain. The rod model uses the outer-tube material for both tubes and averages the notch
          length/spacing. Errors are normalized by the active length.
        </div>
      </div>
    </div>
  );
}
