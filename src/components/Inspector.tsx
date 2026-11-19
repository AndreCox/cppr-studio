import { useMemo, useState } from 'react';
import type { Material, Project, SegmentConfig, SegmentResult } from '../core/types';
import { compileDesiredCurve, waypointsFromCurve } from '../core/geometry/curve';
import { findMaterial } from '../core/materials';
import { PRESET_PROFILES } from '../core/geometry/curve';
import {
  Button, Chip, Collapsible, Field, Icon, LogSlider, NumberField, Segmented, SelectField, Toggle, fmt,
} from './ui';
import type { CosseratResult, SolverMode } from '../core/cosserat/solver';

interface Props {
  project: Project;
  cfg: SegmentConfig;
  res: SegmentResult | undefined;
  onChange: (patch: Partial<SegmentConfig>, recordHistory?: boolean) => void;
  onMaterialChange: (id: string, patch: Partial<Material>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  solverMode: SolverMode;
  onSolverMode: (mode: SolverMode) => void;
  gravityEnabled: boolean;
  onGravityEnabled: (enabled: boolean) => void;
  planar: boolean;
  onPlanar: (planar: boolean) => void;
  cosserat: CosseratResult | null;
  cosseratPending: boolean;
  cosseratError: string | null;
  showBendingModel?: boolean;
}

export function Inspector({
  project, cfg, res, onChange, onMaterialChange, onDuplicate, onDelete, onMove, canMoveUp, canMoveDown,
  solverMode, onSolverMode, gravityEnabled, onGravityEnabled, planar, onPlanar,
  cosserat, cosseratPending, cosseratError, showBendingModel = true,
}: Props) {
  const matO = findMaterial(project.materials, cfg.outerTube.materialId);
  const matI = findMaterial(project.materials, cfg.innerTube.materialId);
  const [editMaterial, setEditMaterial] = useState<string>(cfg.outerTube.materialId);
  const material = project.materials.find((m) => m.id === editMaterial) ?? matO;

  const curve = useMemo(() => compileDesiredCurve(cfg.shape, cfg.activeLength), [cfg.shape, cfg.activeLength]);
  const bendRadius = cfg.shape.kappaMax > 1e-9 ? 1 / cfg.shape.kappaMax : 0;
  const maxNotchKappa = res ? res.notches.reduce((a, n) => Math.max(a, Math.abs(n.kappaTarget)), 0) : 0;
  const clearance = (cfg.outerTube.od - 2 * cfg.outerTube.wall - cfg.innerTube.od) / 2;
  const allowO = (cfg.strainLimitOverride ?? matO.strainLimit) / cfg.safetyFactor;
  const allowI = (cfg.strainLimitOverride ?? matI.strainLimit) / cfg.safetyFactor;
  const condition = res ? (res.errors.length ? 'err' : res.warnings.length ? 'warn' : 'ok') : 'gray';
  const solverStatus = solverMode !== 'cosserat'
    ? null
    : cosseratPending
      ? { tone: 'pending', text: 'Solving rod model…' }
      : cosseratError
        ? { tone: 'error', text: cosseratError }
        : !cosserat
          ? { tone: 'pending', text: 'Waiting for design…' }
          : cosserat.converged
            ? { tone: 'ok', text: `Converged · ${cosserat.iterations} it · ${(cosserat.solveTimeMs / 1000).toFixed(2)} s` }
            : { tone: 'warn', text: `Best effort · ${cosserat.iterations} it · ${(cosserat.solveTimeMs / 1000).toFixed(1)} s` };

  const presetOptions = (Object.keys(PRESET_PROFILES) as (keyof typeof PRESET_PROFILES)[]).map((p) => ({
    value: p,
    label: PRESET_PROFILES[p].label,
  }));

  const setPreset = (preset: string) => {
    if (preset === '__custom') {
      const pts = waypointsFromCurve(curve, 6);
      onChange({ shape: { ...cfg.shape, kind: 'waypoints', waypoints: pts } });
    } else {
      onChange({ shape: { ...cfg.shape, kind: 'preset', preset: preset as SegmentConfig['shape']['preset'] } });
    }
  };

  const transmission = cfg.transmission;
  const clearanceOk = clearance >= cfg.minClearance - 5e-4;
  const matOptions = project.materials.map((m) => ({ value: m.id, label: m.name }));

  return (
    <div className="sidebar right">
      <div className="insp-title">
        <div className="flex gap8" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <input
              className="input"
              style={{ height: 32, fontWeight: 650, fontSize: 14, padding: '0 8px' }}
              value={cfg.name}
              onChange={(e) => onChange({ name: e.target.value }, false)}
              aria-label="Segment name"
            />
            <div className="sub" style={{ marginTop: 5 }}>
              {cfg.notches} notches · L {cfg.activeLength.toFixed(1)} mm · ⌀{cfg.outerTube.od.toFixed(2)} / ⌀{cfg.innerTube.od.toFixed(2)} mm
            </div>
          </div>
          <div className="flex gap4">
            <button type="button" className="btn ghost icon sm" title="Move earlier" disabled={!canMoveUp} onClick={() => onMove(-1)}><Icon name="arrowUp" className="sm" /></button>
            <button type="button" className="btn ghost icon sm" title="Move later" disabled={!canMoveDown} onClick={() => onMove(1)}><Icon name="arrowDown" className="sm" /></button>
          </div>
        </div>
        <div className="pill-row">
          <Chip tone={condition as 'ok' | 'warn' | 'err' | 'gray'} icon={condition === 'ok' ? 'check' : condition === 'err' ? 'error' : 'alert'}>
            {!res ? 'Not designed' : res.errors.length ? `${res.errors.length} error${res.errors.length > 1 ? 's' : ''}` : res.warnings.length ? `${res.warnings.length} warning${res.warnings.length > 1 ? 's' : ''}` : 'Design ready'}
          </Chip>
          {res && res.designState?.converged && <Chip tone="gray" icon="target">q {res.qDesign.toFixed(2)} mm</Chip>}
          {res && <Chip tone="gray" icon="scale">{fmt.pct(res.rmsError, 1)} fit</Chip>}
        </div>
      </div>

      <div className="sidebar-scroll">

        {showBendingModel && (
        <Collapsible
          title="Bending model"
          badge={<Chip tone={solverMode === 'cosserat' ? (cosserat?.converged ? 'ok' : cosserat ? 'warn' : 'info') : 'gray'}>{solverMode === 'cosserat' ? 'Cosserat' : 'Analytic'}</Chip>}
        >
          <Segmented
            value={solverMode}
            onChange={onSolverMode}
            options={[
              { value: 'analytic', label: 'Analytic' },
              { value: 'cosserat', label: 'Cosserat' },
            ]}
          />
          <div className="solver-controls">
            <Toggle
              label="Planar (2D)"
              checked={planar}
              onChange={onPlanar}
              disabled={solverMode !== 'cosserat'}
              hint="Planar reduction — recommended for the planar notch schedules"
            />
            <Toggle
              label="Gravity"
              checked={gravityEnabled}
              onChange={onGravityEnabled}
              disabled={solverMode !== 'cosserat' || planar}
              hint="Include self-weight in the Cosserat rod solve (full 3D only)"
            />
          </div>
          {solverStatus && (
            <div
              className={`solver-status ${solverStatus.tone}`}
              title={cosseratError ?? (cosserat ? `Residual ${cosserat.residual.toExponential(1)}${cosserat.message ? ` · ${cosserat.message}` : ''}` : undefined)}
            >
              <span className="solver-dot" />
              <span>{solverStatus.text}</span>
            </div>
          )}
          <div className="solver-note">
            Runs the Cosserat rod solver (WebAssembly) over the designed notch depths and push/pull. Uses the outer-tube
            material for both tubes and averaged notch spacing; full 3D may take several seconds.
          </div>
        </Collapsible>
        )}
        <Collapsible title="Target shape" badge={<Chip tone="info" icon="spline">κ</Chip>}>
          <SelectField
            label="Shape preset"
            value={cfg.shape.kind === 'waypoints' ? '__custom' : cfg.shape.preset}
            onChange={setPreset}
            options={[...presetOptions, { value: '__custom', label: 'Custom (drag handles)' }]}
            hint={cfg.shape.kind === 'waypoints' ? 'custom' : undefined}
          />
          <p className="help-text" style={{ marginTop: -4, marginBottom: 10 }}>
            {cfg.shape.kind === 'waypoints'
              ? 'Custom control polygon. Drag the round handles in the 2D view; the curve is normalised to the active length.'
              : PRESET_PROFILES[cfg.shape.preset].description}
          </p>
          {cfg.shape.kind === 'preset' && cfg.shape.preset !== 'straight' && (
            <>
              <NumberField
                label="Peak bend radius"
                value={bendRadius}
                onChange={(v) => onChange({ shape: { ...cfg.shape, kappaMax: 1 / Math.max(0.5, v) } })}
                unit="mm"
                min={2}
                max={5000}
                precision={1}
                step={1}
                hint={`κ ≤ ${(cfg.shape.kappaMax * 1000).toFixed(1)} 1/m`}
                tooltip="Minimum centreline radius of the desired shape. Only (1−β) of the length is notched, so the notch curvatures are higher than this by roughly 1/(1−β)."
              />
              <LogSlider
                label="Bend intensity"
                value={bendRadius}
                min={4}
                max={2000}
                onChange={(v) => onChange({ shape: { ...cfg.shape, kappaMax: 1 / v } })}
                format={(v) => `${v.toFixed(0)} mm radius`}
                hint="← tighter · gentler →"
              />
            </>
          )}
          <div className="row2">
            <NumberField label="Active length" value={cfg.activeLength} onChange={(v) => onChange({ activeLength: v })} unit="mm" min={5} max={2000} precision={1} step={1} />
            <NumberField label="Notches" value={cfg.notches} onChange={(v) => onChange({ notches: Math.max(1, Math.round(v)) })} min={1} max={80} precision={0} step={1} />
          </div>
          <NumberField
            label="β — straight fraction"
            value={cfg.beta}
            onChange={(v) => onChange({ beta: v })}
            min={0.05}
            max={0.95}
            precision={3}
            step={0.01}
            hint="0.5 recommended"
            tooltip="Fraction of the centreline that is straight rigid tube. The remaining 1−β is notched and bends."
          />
          <SelectField
            label="Curve fitting"
            value={cfg.fitMode}
            onChange={(v) => onChange({ fitMode: v as SegmentConfig['fitMode'] })}
            options={[
              { value: 'sequential', label: 'Sequential fit (paper method)' },
              { value: 'direct', label: 'Turn matching (simpler)' },
            ]}
            tooltip="Sequential fit solves each notch so its endpoint lands on the desired curve's normal. Turn matching divides the desired tangent change by the notch length."
          />
          <div className="metric-grid" style={{ marginTop: 8 }}>
            <div className="metric"><div className="v">{(curve.tipAngle * 180 / Math.PI).toFixed(1)}°</div><div className="l">target tip angle</div></div>
            <div className="metric"><div className="v">{maxNotchKappa ? fmt.kappa(maxNotchKappa) : '—'}</div><div className="l">max notch κ</div></div>
            <div className="metric"><div className="v">{res?.kappaCapacity ? `${(1 / res.kappaCapacity).toFixed(1)} mm` : '—'}</div><div className="l">capacity R</div></div>
            <div className="metric"><div className="v">{fmt.pct(res?.rmsError ?? 0, 1)}</div><div className="l">shape fit</div></div>
          </div>
          {res && res.kappaCapacity && maxNotchKappa > res.kappaCapacity * 1.01 && (
            <div className="callout warn" style={{ marginTop: 8 }}>
              Target exceeds the achievable curvature for this tube pair and strain limit. The design will be depth-capped.
            </div>
          )}
        </Collapsible>

        <Collapsible title="Mounting & assembly" defaultOpen={false} badge={<Chip tone="gray">{cfg.rollDeg}° roll</Chip>}>
          <div className="row2">
            <NumberField
              label="Mounting roll"
              value={cfg.rollDeg}
              onChange={(v) => onChange({ rollDeg: v })}
              unit="°"
              min={-360}
              max={360}
              precision={0}
              step={15}
              tooltip="Rotation of this segment's bending plane about its base tangent. Use 90° to build a non-planar multi-section robot."
            />
            <div style={{ paddingTop: 18 }}>
              <Toggle label="Enabled" checked={cfg.enabled} onChange={(v) => onChange({ enabled: v })} />
            </div>
          </div>
          <Toggle
            label="First-notch lockout when pushed"
            checked={cfg.firstNotchLockout}
            onChange={(v) => onChange({ firstNotchLockout: v })}
            hint="The inner tube's solid section holds the first notch straight for negative actuation."
          />
          <p className="help-text">
            Each enabled pair contributes 3 actuated DOF: insertion, bending and roll. The assembly places each segment at the previous tip,
            rotated by its mounting roll.
          </p>
        </Collapsible>

        <Collapsible title="Tubes & materials" badge={
          <Chip tone={clearanceOk ? 'ok' : 'warn'}>{clearance.toFixed(3)} mm</Chip>
        }>
          <div className="tiny faint" style={{ marginBottom: 6, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Outer tube</div>
          <div className="row2">
            <NumberField label="OD" value={cfg.outerTube.od} onChange={(v) => onChange({ outerTube: { ...cfg.outerTube, od: v } })} unit="mm" min={0.5} max={200} precision={2} step={0.01} />
            <NumberField label="Wall" value={cfg.outerTube.wall} onChange={(v) => onChange({ outerTube: { ...cfg.outerTube, wall: v } })} unit="mm" min={0.02} max={50} precision={3} step={0.01} />
          </div>
          <SelectField label="Outer material" value={cfg.outerTube.materialId} onChange={(v) => onChange({ outerTube: { ...cfg.outerTube, materialId: v } })} options={matOptions} />
          <div className="tiny faint" style={{ marginTop: -6, marginBottom: 10 }}>
            ID {((cfg.outerTube.od - 2 * cfg.outerTube.wall)).toFixed(3)} mm · E {matO.E.toLocaleString()} MPa · εmax {fmt.pct(matO.strainLimit)}
          </div>
          <div className="tiny faint" style={{ marginBottom: 6, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Inner tube</div>
          <div className="row2">
            <NumberField label="OD" value={cfg.innerTube.od} onChange={(v) => onChange({ innerTube: { ...cfg.innerTube, od: v } })} unit="mm" min={0.4} max={199} precision={2} step={0.01} />
            <NumberField label="Wall" value={cfg.innerTube.wall} onChange={(v) => onChange({ innerTube: { ...cfg.innerTube, wall: v } })} unit="mm" min={0.02} max={50} precision={3} step={0.01} />
          </div>
          <SelectField label="Inner material" value={cfg.innerTube.materialId} onChange={(v) => onChange({ innerTube: { ...cfg.innerTube, materialId: v } })} options={matOptions} />
          <div className="tiny faint" style={{ marginTop: -6, marginBottom: 10 }}>
            ID {((cfg.innerTube.od - 2 * cfg.innerTube.wall)).toFixed(3)} mm · E {matI.E.toLocaleString()} MPa · εmax {fmt.pct(matI.strainLimit)}
          </div>
          <div className="row2">
            <NumberField
              label="Outer solid extension"
              value={cfg.outerExtension ?? 0}
              onChange={(v) => onChange({ outerExtension: Math.max(0, v) })}
              unit="mm"
              min={0}
              max={600}
              precision={0}
              step={5}
              hint="beyond the base"
              tooltip="A solid proximal extension of the outer tube, joined to the transmission. Enable the transmission coupler to add a sleeve over the joint. It is included in the complete outer STL and laser pattern; tip-only files omit it."
            />
            <NumberField
              label="Inner handle extension"
              value={cfg.innerExtension}
              onChange={(v) => onChange({ innerExtension: Math.max(0, v) })}
              unit="mm"
              min={0}
              max={600}
              precision={0}
              step={5}
              hint="solid, beyond the base"
              tooltip="Extra proximal length of the inner tube beyond the outer tube, so it can be gripped and pulled by hand. It does not change the active kinematics; it is included in the complete inner STL and the laser pattern. Align the distal tips during assembly."
            />
          </div>
          {(() => {
            const extO = Math.max(0, cfg.outerExtension ?? 0);
            const extI = Math.max(0, cfg.innerExtension || 0);
            const c = cfg.transmission.coupler;
            if (!c?.enabled) return null;
            const innerCouplerOd = cfg.innerTube.od + 2 * (c.clearance + c.wall);
            const outerId = cfg.outerTube.od - 2 * cfg.outerTube.wall;
            const innerFits = innerCouplerOd <= outerId - 2 * cfg.minClearance + 1e-6;
            return (
              <div className="callout" style={{ marginBottom: 8 }}>
                <div className="tiny">
                  Coupler applies to {c.tubes === 'both' ? 'both tubes' : `${c.tubes} tube`}. 
                  {extO <= 0 && extI <= 0 ? ' Add a solid extension above so there is a joint to bridge.' : ''}
                  {c.tubes !== 'outer' && extI > 0 && !innerFits ? ` Inner coupler OD ${innerCouplerOd.toFixed(2)} mm exceeds the outer bore clearance; the sleeve will not pass inside the outer tube.` : ''}
                </div>
              </div>
            );
          })()}
          <div className="callout" style={{ marginBottom: 8 }}>
            <div className="tiny faint">
              The solid extension is the proximal solid transmission tube. The coupler is a separate printed sleeve that bridges the extension and the existing transmission, so the two tubes are mechanically connected. The coupler is exported as its own STL and is not a laser pattern cut.
            </div>
          </div>
          <div className="callout" style={{ marginBottom: 8 }}>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span>Radial clearance <b>{clearance.toFixed(3)} mm</b></span>
              <span className={`chip ${clearanceOk ? 'ok' : 'warn'}`} style={{ height: 18, fontSize: 9.5 }}>{clearanceOk ? 'fits' : 'too tight'}</span>
            </div>
            <div className="tiny" style={{ marginTop: 5 }}>Tip bond + sliding fit. Printed parts need more clearance than metal hypotube.</div>
            <Button size="xs" variant="ghost" onClick={() => onChange({ innerTube: { ...cfg.innerTube, od: Math.max(0.5, cfg.outerTube.od - 2 * cfg.outerTube.wall - 2 * cfg.minClearance) } })}>
              Fit inner OD to clearance
            </Button>
          </div>
          <Field label="Cut profile" tooltip="Chord cuts have a flat floor (mill or print). Radial cuts are cut from the side with a laser and have radially aligned faces.">
            <div className="btn-group" style={{ width: '100%' }}>
              <button type="button" className={`btn sm ${cfg.cutType === 'chord' ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => onChange({ cutType: 'chord' })}>
                <Icon name="wrench" className="sm" /> Chord (print/mill)
              </button>
              <button type="button" className={`btn sm ${cfg.cutType === 'radial' ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => onChange({ cutType: 'radial' })}>
                <Icon name="zap" className="sm" /> Radial (laser)
              </button>
            </div>
          </Field>
          <NumberField label="Minimum radial clearance" value={cfg.minClearance} onChange={(v) => onChange({ minClearance: v })} unit="mm" min={0} max={5} precision={3} step={0.01} />
        </Collapsible>

        <Collapsible
          title="Tip cross-pin"
          defaultOpen={false}
          badge={<Chip tone={cfg.tipFeature.enabled ? 'ok' : 'gray'}>{cfg.tipFeature.enabled ? `Ø${cfg.tipFeature.holeDiameter.toFixed(1)} cross-pin` : 'off'}</Chip>}
        >
          <p className="help-text">
            Extends both tube tips by a short straight collar and cuts a diametric cross-hole through both walls. The two openings
            are 180° apart. Align the assembled tubes and insert a 1.75 mm filament pin through the holes; trim or melt the ends to
            lock the tips together. The extension and holes are included in the printed STLs and the laser patterns.
          </p>
          <Toggle
            label="Enable tip cross-pin"
            checked={cfg.tipFeature.enabled}
            onChange={(v) => onChange({ tipFeature: { ...cfg.tipFeature, enabled: v } })}
          />
          {cfg.tipFeature.enabled && (
            <>
              <div className="row2">
                <NumberField
                  label="Tip extension"
                  value={cfg.tipFeature.extension}
                  onChange={(v) => onChange({ tipFeature: { ...cfg.tipFeature, extension: v } })}
                  unit="mm"
                  min={3}
                  max={30}
                  precision={1}
                  step={0.5}
                  hint="both tips"
                />
                <NumberField
                  label="Hole Ø"
                  value={cfg.tipFeature.holeDiameter}
                  onChange={(v) => onChange({ tipFeature: { ...cfg.tipFeature, holeDiameter: v } })}
                  unit="mm"
                  min={1}
                  max={8}
                  precision={2}
                  step={0.05}
                  hint="use ≈2.0 for 1.75 mm"
                />
              </div>
              <div className="row2">
                <NumberField
                  label="Hole distance from tip"
                  value={cfg.tipFeature.holeDistance}
                  onChange={(v) => onChange({ tipFeature: { ...cfg.tipFeature, holeDistance: v } })}
                  unit="mm"
                  min={cfg.tipFeature.holeDiameter / 2 + 0.6}
                  max={Math.max(cfg.tipFeature.holeDiameter / 2 + 0.6, cfg.tipFeature.extension - cfg.tipFeature.holeDiameter / 2 - 0.6)}
                  precision={1}
                  step={0.5}
                  hint="centre to end"
                />
                <NumberField
                  label="Hole angle"
                  value={cfg.tipFeature.angleDeg}
                  onChange={(v) => onChange({ tipFeature: { ...cfg.tipFeature, angleDeg: v } })}
                  unit="°"
                  min={0}
                  max={360}
                  precision={0}
                  step={5}
                  hint="around the tube"
                />
              </div>
              <div className="callout">
                <div className="tiny">
                  Hole Ø {cfg.tipFeature.holeDiameter.toFixed(2)} mm · centre {cfg.tipFeature.holeDistance.toFixed(1)} mm from the
                  final tip · openings 180° apart. Both tubes get the same extension and aligned holes; a 1.75 mm filament pin
                  (~outer OD + 20 mm long) locks the pair. Printed holes come out undersized.
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => onChange({ tipFeature: {
                    ...cfg.tipFeature, enabled: true, extension: 6, holeDiameter: 2.0,
                    holeDistance: 2.0, angleDeg: 90,
                  } })}
                >
                  Use 1.75 mm filament preset
                </Button>
              </div>
            </>
          )}
        </Collapsible>

        <Collapsible title="Limits & strain" defaultOpen={false} badge={<Chip tone="gray">{fmt.pct(allowO, 1)}</Chip>}>
          <Toggle
            label="Override material strain limit"
            checked={cfg.strainLimitOverride !== null}
            onChange={(v) => onChange({ strainLimitOverride: v ? matO.strainLimit : null })}
          />
          {cfg.strainLimitOverride !== null && (
            <div style={{ marginTop: 8 }}>
              <NumberField
                label="Strain limit"
                value={cfg.strainLimitOverride * 100}
                onChange={(v) => onChange({ strainLimitOverride: v / 100 })}
                unit="%"
                min={0.05}
                max={50}
                precision={2}
                step={0.1}
              />
            </div>
          )}
          <div className="row2">
            <NumberField label="Safety factor" value={cfg.safetyFactor} onChange={(v) => onChange({ safetyFactor: Math.max(1, v) })} min={1} max={10} precision={2} step={0.1} />
            <NumberField label="Min backbone" value={cfg.minBackbone} onChange={(v) => onChange({ minBackbone: v })} unit="mm" min={0.01} max={20} precision={2} step={0.01} tooltip="Minimum remaining material width at the deepest notch. Keep above the printer nozzle / laser kerf limit." />
          </div>
          <NumberField
            label="Depth cap"
            value={cfg.maxDepthFrac * 100}
            onChange={(v) => onChange({ maxDepthFrac: v / 100 })}
            unit="%"
            min={10}
            max={99}
            precision={0}
            step={1}
            hint={cfg.cutType === 'chord' ? 'of OD' : 'of πR'}
            tooltip={cfg.cutType === 'chord' ? 'Maximum chord depth as a percentage of the outer diameter.' : 'Maximum radial cut parameter as a percentage of the half-circumference (πR).'}
          />
          <div className="callout info">
            Allowable strain: outer <b>{fmt.pct(allowO)}</b> · inner <b>{fmt.pct(allowI)}</b>.<br />
            {res && <span className="tiny">Peak utilisation {res.notches.length ? fmt.pct(Math.max(...res.notches.map((n) => n.strainUtilisation)), 0) : '—'} of allowable.</span>}
          </div>
          <p className="help-text">The design uses the full strain budget to maximise stiffness: every notch reaches the allowable strain at the target shape. Increase the safety factor for a more compliant, lower-force robot.</p>
        </Collapsible>

        <Collapsible title="Transmission" defaultOpen={false} badge={<Chip tone="gray">{cfg.transmission.length.toFixed(0)} mm</Chip>}>
          <NumberField label="Transmission length" value={transmission.length} onChange={(v) => onChange({ transmission: { ...transmission, length: v } })} unit="mm" min={0} max={5000} precision={0} step={10} />
          {(() => {
            const idx = project.segments.findIndex((s) => s.id === cfg.id);
            if (idx <= 0) {
              return <p className="help-text" style={{ marginTop: -4 }}>For the proximal pair this is the handle/sheath length behind the base; it does not bend.</p>;
            }
            const upstream = project.segments.slice(0, idx).filter((s) => s.enabled).reduce((a, s) => a + s.activeLength, 0);
            const suggested = Math.max(20, Math.round(upstream + 10));
            return (
              <div className="tiny faint" style={{ marginTop: -4, marginBottom: 8 }}>
                The distal pair's transmission must reach from the base past the {upstream.toFixed(0)} mm of upstream bending section.
                Extra length sits behind the base as a handle/coil.{' '}
                <Button size="xs" variant="ghost" onClick={() => onChange({ transmission: { ...transmission, length: suggested } })}>
                  Fit to {suggested} mm
                </Button>
              </div>
            );
          })()}
          <div className="callout info" style={{ marginBottom: 10 }}>
            <div className="tiny">
              Both tubes of a pair run from the base to the tip. The <b>outer transmission</b> is the outer sheath/handle; the
              <b> inner transmission</b> is the sliding shaft inside it. Pattern them when the pair must flex through a curved channel
              or through a proximal bending segment. A free-standing handheld robot usually wants a <b>solid outer handle</b>; distal
              pairs that pass through a bent proximal section need a flexible pattern.
            </div>
          </div>
          <Field label="Outer transmission">
            <div className="btn-group" style={{ width: '100%' }}>
              {(['solid', 'brickwork', 'discrete'] as const).map((p) => (
                <button key={p} type="button" className={`btn sm ${transmission.pattern === p ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => onChange({ transmission: { ...transmission, pattern: p } })}>
                  {p === 'solid' ? 'Solid' : p === 'brickwork' ? 'Brickwork' : 'Discrete'}
                </button>
              ))}
            </div>
          </Field>
          <SelectField
            label="Inner transmission"
            value={transmission.innerPattern ?? 'same'}
            onChange={(v) => onChange({ transmission: { ...transmission, innerPattern: v as 'same' | 'solid' | 'brickwork' | 'discrete' } })}
            options={[
              { value: 'same', label: 'Same as outer' },
              { value: 'solid', label: 'Solid' },
              { value: 'brickwork', label: 'Brickwork' },
              { value: 'discrete', label: 'Discrete' },
            ]}
            hint="Outer and inner can differ"
          />
          {(() => {
            const fieldPattern = transmission.pattern !== 'solid'
              ? transmission.pattern
              : (transmission.innerPattern && transmission.innerPattern !== 'same' && transmission.innerPattern !== 'solid'
                  ? transmission.innerPattern
                  : 'solid');
            if (fieldPattern === 'solid') return null;
            return (
              <>
                <div className="row2">
                  <NumberField label="Kerf" value={transmission.kerf} onChange={(v) => onChange({ transmission: { ...transmission, kerf: v } })} unit="mm" min={0.01} max={2} precision={3} step={0.01} />
                  <NumberField label="Pitch" value={transmission.pitch} onChange={(v) => onChange({ transmission: { ...transmission, pitch: v } })} unit="mm" min={0.05} max={10} precision={3} step={0.01} />
                </div>
                {fieldPattern === 'brickwork' ? (
                  <div className="row2">
                    <NumberField label="Cuts / rev" value={transmission.cutsPerRev} onChange={(v) => onChange({ transmission: { ...transmission, cutsPerRev: Math.round(v) } })} min={2} max={12} precision={0} step={1} />
                    <NumberField label="Overlap" value={transmission.overlapDeg} onChange={(v) => onChange({ transmission: { ...transmission, overlapDeg: v } })} unit="°" min={-30} max={60} precision={0} step={1} />
                  </div>
                ) : (
                  <>
                    <div className="row2">
                      <NumberField label="Levels" value={transmission.levels} onChange={(v) => onChange({ transmission: { ...transmission, levels: Math.round(v) } })} min={2} max={20} precision={0} step={1} />
                      <NumberField label="Cuts / rev" value={transmission.cutsPerRev} onChange={(v) => onChange({ transmission: { ...transmission, cutsPerRev: Math.max(2, Math.round(v)) } })} min={2} max={16} precision={0} step={2} tooltip="Number of circumferential slots around each row. Must be even: two wider α posts remain 180° apart." />
                    </div>
                    <div className="row2">
                      <NumberField label="Separation α" value={transmission.separationDeg} onChange={(v) => onChange({ transmission: { ...transmission, separationDeg: v } })} unit="°" min={1} max={90} precision={1} step={0.5} tooltip="Angular width of the two solid posts that carry axial load." />
                      <NumberField label="Bridge / overlap β" value={transmission.overlapDeg} onChange={(v) => onChange({ transmission: { ...transmission, overlapDeg: v } })} unit="°" min={1} max={90} precision={1} step={0.5} />
                    </div>
                    <div className="row2">
                      <NumberField label="Riffle angle" value={transmission.riffleDeg} onChange={(v) => onChange({ transmission: { ...transmission, riffleDeg: v } })} unit="°" min={10} max={180} precision={2} step={0.25} hint="68.75° golden" tooltip="Rotation between successive discrete bending segments. 68.75° (the golden angle) avoids repeated bending axes." />
                      <NumberField label="Solid gap (0 = auto)" value={transmission.gap} onChange={(v) => onChange({ transmission: { ...transmission, gap: v } })} unit="mm" min={0} max={200} precision={2} step={0.1} />
                    </div>
                    <NumberField label="Required max curvature" value={transmission.maxCurvature * 1000} onChange={(v) => onChange({ transmission: { ...transmission, maxCurvature: v / 1000 } })} unit="1/m" min={0.5} max={200} precision={1} step={0.5} tooltip="The tightest bend the transmission must follow (e.g. the endoscope channel). The solid gap is derived from this and the tube clearance." />
                  </>
                )}
                <div className="callout">
                  <div className="tiny">
                    Auto gap uses κmax ≈ 8c/L². The pattern is exported to SVG/DXF and included in the complete-tube STL; tip-only STLs omit it.
                    Pattern parameters apply to both tubes where applicable.
                  </div>
                </div>
                <div className="flex gap6" style={{ flexWrap: 'wrap' }}>
                  <Button size="xs" variant="ghost" onClick={() => onChange({ transmission: { ...transmission, riffleDeg: 68.75, separationDeg: 15, overlapDeg: 15 } })}>
                    Paper defaults
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onChange({ transmission: { ...transmission, pattern: 'discrete', innerPattern: 'same', cutsPerRev: 4, kerf: 0.6, pitch: 1.2, levels: 3, separationDeg: 30, overlapDeg: 20 } })}>
                    Printable features
                  </Button>
                </div>
              </>
            );
          })()}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div className="tiny faint" style={{ fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 6 }}>
              Solid extension coupler
            </div>
            <Toggle
              label="Add coupler sleeve"
              checked={!!transmission.coupler?.enabled}
              onChange={(v) => onChange({ transmission: { ...transmission, coupler: { ...transmission.coupler, enabled: v } } })}
              hint="A separate sleeve bridges a solid extension and the transmission"
            />
            {transmission.coupler?.enabled && (
              <>
                <SelectField
                  label="Coupler tubes"
                  value={transmission.coupler.tubes}
                  onChange={(v) => onChange({ transmission: { ...transmission, coupler: { ...transmission.coupler, tubes: v as 'outer' | 'inner' | 'both' } } })}
                  options={[{ value: 'both', label: 'Outer + inner' }, { value: 'outer', label: 'Outer only' }, { value: 'inner', label: 'Inner only' }]}
                />
                <div className="row2">
                  <NumberField label="Coupler length" value={transmission.coupler.length} onChange={(v) => onChange({ transmission: { ...transmission, coupler: { ...transmission.coupler, length: v } } })} unit="mm" min={4} max={100} precision={1} step={1} />
                  <NumberField label="Sleeve wall" value={transmission.coupler.wall} onChange={(v) => onChange({ transmission: { ...transmission, coupler: { ...transmission.coupler, wall: v } } })} unit="mm" min={0.2} max={10} precision={2} step={0.1} />
                </div>
                <NumberField label="Radial clearance" value={transmission.coupler.clearance} onChange={(v) => onChange({ transmission: { ...transmission, coupler: { ...transmission.coupler, clearance: v } } })} unit="mm" min={0} max={2} precision={2} step={0.05} hint="over tube OD" />
                <div className="callout">
                  <div className="tiny">
                    Requires a solid extension on the selected tube(s). The coupler sits across the joint; if the inner coupler cannot pass inside the outer tube, reduce its wall/clearance or omit the inner coupler.
                  </div>
                </div>
              </>
            )}
          </div>

        </Collapsible>

        <Collapsible title="Material library" defaultOpen={false}>
          <SelectField label="Edit material" value={editMaterial} onChange={setEditMaterial} options={project.materials.map((m) => ({ value: m.id, label: m.name }))} />
          <div className="row2">
            <NumberField label="Young's modulus" value={material.E} onChange={(v) => onMaterialChange(material.id, { E: v })} unit="MPa" min={1} max={500000} precision={0} step={100} />
            <NumberField label="Strain limit" value={material.strainLimit * 100} onChange={(v) => onMaterialChange(material.id, { strainLimit: v / 100 })} unit="%" min={0.05} max={100} precision={2} step={0.1} />
          </div>
          <div className="row2">
            <NumberField label="Poisson ratio" value={material.nu} onChange={(v) => onMaterialChange(material.id, { nu: v })} min={0.05} max={0.49} precision={2} step={0.01} />
            <NumberField label="Density" value={material.density} onChange={(v) => onMaterialChange(material.id, { density: v })} unit="g/cm³" min={0.1} max={25} precision={2} step={0.01} />
          </div>
          <p className="help-text">These values apply immediately to every segment using this material. Use measured datasheet values for your stock.</p>
        </Collapsible>

        <Collapsible title="Notes" defaultOpen={false}>
          <textarea className="input" rows={4} value={cfg.notes} onChange={(e) => onChange({ notes: e.target.value }, false)} placeholder="Fabrication notes, revision, material lot…" />
        </Collapsible>
      </div>

      <div className="insp-footer">
        <div className="flex gap6" style={{ justifyContent: 'space-between' }}>
          <Button size="sm" icon="copy" onClick={onDuplicate}>Duplicate</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={onDelete} disabled={project.segments.length <= 1}>Delete</Button>
        </div>
        <div className="footer-note" style={{ borderTop: 'none', padding: '8px 0 0' }}>
          Model: planar variable-curvature beam with strain-limited, maximum-stiffness notch design. Friction and manufacturing tolerances are not modelled.
        </div>
      </div>
    </div>
  );
}
