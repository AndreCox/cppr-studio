import type { Project, RobotResult } from '../core/types';
import type { TipForce, TipStiffnessResult } from '../core/cosserat/stiffness';
import { Button, Chip, Icon, NumberField, Toggle } from './ui';

interface Props {
  project: Project;
  result: RobotResult;
  force: TipForce;
  onForce: (patch: Partial<TipForce>) => void;
  stiffness: TipStiffnessResult | null;
  pending: boolean;
  error: string | null;
  gravityEnabled: boolean;
  onGravityEnabled: (enabled: boolean) => void;
  plan2d: boolean;
  onPlan2d: (planar: boolean) => void;
  fraction: number;
}

const mm = (v: number, d = 2) => `${v.toFixed(d)} mm`;
const n = (v: number, d = 2) => `${v.toFixed(d)} N`;
const dirLabel = (az: number, el: number) => `az ${az.toFixed(0)}° · el ${el.toFixed(0)}°`;

export function StiffnessPanel({
  project, result, force, onForce, stiffness, pending, error, gravityEnabled, onGravityEnabled, plan2d, onPlan2d, fraction,
}: Props) {
  const status = error ? 'err' : pending ? 'pending' : stiffness ? (stiffness.converged ? 'ok' : 'warn') : 'gray';
  const statusText = error
    ? 'Solve failed'
    : pending
      ? 'Solving 3D chain…'
      : !stiffness
        ? 'Waiting for a design'
        : stiffness.converged
          ? `Converged · ${stiffness.solveTimeMs < 1 ? '<1' : stiffness.solveTimeMs.toFixed(0)} ms`
          : 'Best-effort shape';
  const setDirection = (azimuthDeg: number, elevationDeg: number) => onForce({ azimuthDeg, elevationDeg });

  return (
    <div className="sidebar right">
      <div className="panel-head">
        <div className="panel-title">Tip stiffness</div>
        <Chip tone={status === 'err' ? 'err' : status === 'warn' ? 'warn' : status === 'pending' ? 'info' : 'ok'}>{statusText}</Chip>
      </div>
      <div className="sidebar-scroll">
        <div className="left-section">
          <div className="panel-title" style={{ marginBottom: 8 }}>Tip load</div>
          <NumberField
            label="Force magnitude"
            value={force.magnitude}
            onChange={(v) => onForce({ magnitude: v })}
            unit="N"
            min={0}
            max={10}
            precision={2}
            step={0.01}
            hint={`${fraction.toFixed(2)}× actuation`}
            tooltip="A point force applied at the distal tip in the loaded 3D Cosserat solve. The unloaded baseline uses the same actuation and gravity."
          />
          <div className="row2">
            <NumberField
              label="Azimuth"
              value={force.azimuthDeg}
              onChange={(v) => onForce({ azimuthDeg: v })}
              unit="°"
              min={-360}
              max={360}
              precision={0}
              step={5}
              hint="from +X"
            />
            <NumberField
              label="Elevation"
              value={force.elevationDeg}
              onChange={(v) => onForce({ elevationDeg: v })}
              unit="°"
              min={-90}
              max={90}
              precision={0}
              step={5}
              hint="from XY"
            />
          </div>
          <div className="stiffness-presets">
            <Button size="xs" variant="ghost" onClick={() => setDirection(0, 0)}>+X side</Button>
            <Button size="xs" variant="ghost" onClick={() => setDirection(90, 0)}>+Y side</Button>
            <Button size="xs" variant="ghost" onClick={() => setDirection(0, 90)}>+Z axial</Button>
            <Button size="xs" variant="ghost" onClick={() => setDirection(0, -90)}>−Z axial</Button>
          </div>
          <Toggle
            label="Planar 2D model"
            checked={plan2d}
            onChange={onPlan2d}
            hint="Project the force into the base X–Z bending plane"
          />
          <Toggle
            label="Include gravity"
            checked={gravityEnabled}
            onChange={onGravityEnabled}
            hint="Same gravity in the baseline and loaded solve"
          />
          <div className="callout info" style={{ marginTop: 8 }}>
            <div className="tiny">
              Force is applied at the chain tip. The dashed ghost is the unloaded shape; the amber arrow is the modelled force direction.
              Planar 2D projects the force into the base X–Z bending plane; use full 3D for out-of-plane loads.
            </div>
          </div>
        </div>

        {error && (
          <div className="left-section">
            <div className="callout err">
              <strong>Could not solve the tip load.</strong> {error}
            </div>
          </div>
        )}

        {!error && (
          <div className="left-section">
            <div className="panel-title" style={{ marginBottom: 8 }}>Result</div>
            {pending && !stiffness && (
              <div className="solver-status pending"><span className="solver-dot" /> Solving the 3D Cosserat chain…</div>
            )}
            {stiffness && (
              <>
                <div className="stiffness-hero">
                  <div className="l">Directional stiffness</div>
                  <div className="v">
                    {stiffness.effectiveStiffness !== null && Number.isFinite(stiffness.effectiveStiffness)
                      ? stiffness.effectiveStiffness.toFixed(3)
                      : '—'}
                    <span className="u">N/mm</span>
                  </div>
                  <div className="s">
                    {stiffness.compliance !== null ? `${stiffness.compliance.toFixed(3)} mm/N compliance` : 'Apply a force to calculate'}
                  </div>
                </div>
                <div className="metric-grid">
                  <div className="metric"><div className="v">{mm(stiffness.displacementMagnitude)}</div><div className="l">tip displacement</div></div>
                  <div className="metric"><div className="v">{stiffness.overallStiffness !== null ? `${stiffness.overallStiffness.toFixed(3)} N/mm` : '—'}</div><div className="l">|F| / |Δ|</div></div>
                  <div className="metric"><div className="v">{stiffness.deflectionAngleDeg.toFixed(1)}°</div><div className="l">force / deflection</div></div>
                  <div className="metric"><div className="v">{stiffness.tipRotationDeg.toFixed(2)}°</div><div className="l">tip rotation</div></div>
                  <div className="metric"><div className="v">{n(stiffness.force.magnitude)}</div><div className="l">tip force</div></div>
                  <div className="metric"><div className="v">{dirLabel(force.azimuthDeg, force.elevationDeg)}</div><div className="l">direction</div></div>
                </div>
                <div className="stiffness-components">
                  <div><span>Δx</span><b>{mm(stiffness.displacement[0], 3)}</b></div>
                  <div><span>Δy</span><b>{mm(stiffness.displacement[1], 3)}</b></div>
                  <div><span>Δz</span><b>{mm(stiffness.displacement[2], 3)}</b></div>
                </div>
                <div className="stiffness-note">
                  <Icon name="info" className="sm" />
                  <span>
                    Secant stiffness at this force, direction and pose. Reduce the force to approach the linear tangent stiffness.
                    The full 3D Cosserat chain includes the current actuation and gravity; contact/friction and manufacturing
                    tolerances are not modelled.
                  </span>
                </div>
                {stiffness && force.magnitude > 1e-9 && stiffness.forceUnit.every((v) => Math.abs(v) < 1e-6) && (
                  <div className="callout warn" style={{ marginTop: 8 }}>
                    This force is normal to the base bending plane. Switch off <b>Planar 2D</b> to model the out-of-plane load.
                  </div>
                )}
                {!stiffness.converged && (
                  <div className="callout warn" style={{ marginTop: 8 }}>
                    The rod solve did not fully converge. Treat this as a best-effort estimate and reduce the force.
                  </div>
                )}
                {stiffness.message && <div className="tiny faint" style={{ marginTop: 6 }}>{stiffness.message}</div>}
              </>
            )}
            {!pending && !stiffness && !error && (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <div className="big">No tip-load result</div>
                <p>Fix the design checks, then apply a tip force.</p>
              </div>
            )}
            <div className="tiny faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
              The whole enabled chain is solved; each section uses its designed notch stiffness and the current push/pull.
              The force acts at the distal tip and the reported stiffness is the tip compliance of the assembled robot.
            </div>
            <div className="tiny faint" style={{ marginTop: 6 }}>
              {result.ok ? `${project.segments.filter((s) => s.enabled).length} enabled sections` : 'Design checks must pass before solving.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
