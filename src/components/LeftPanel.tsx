import type { Project, RobotResult } from '../core/types';
import { SEGMENT_COLORS } from '../lib/colors';
import { Button, Icon } from './ui';

interface Props {
  project: Project;
  result: RobotResult;
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onExamples: () => void;
  onHelp: () => void;
  onDiagnostics: () => void;
}

export function LeftPanel(props: Props) {
  const { project, result, selectedId, onSelect, onAdd, onDuplicate, onDelete, onMove, onExamples, onHelp, onDiagnostics } = props;
  const issues = [...result.errors.map((e) => ({ tone: 'err' as const, text: e })), ...result.warnings.map((e) => ({ tone: 'warn' as const, text: e }))];
  const total = result.segments.reduce((a, s) => a + s.activeTubeLength, 0);
  return (
    <aside className="sidebar">
      <div className="panel-head">
        <span className="panel-title">Segments</span>
        <div className="panel-head-actions">
          <button type="button" className="btn ghost icon sm" title="Duplicate selected segment" onClick={onDuplicate}><Icon name="copy" className="sm" /></button>
          <button type="button" className="btn ghost icon sm" title="Add a distal segment" onClick={onAdd}><Icon name="plus" className="sm" /></button>
        </div>
      </div>
      <div className="sidebar-scroll">
        <div className="project-meta">
          <h3 className="nowrap-ellipsis">{project.name}</h3>
          <div className="sub">{project.segments.filter((s) => s.enabled).length} segments · {result.dof} DOF · {total.toFixed(0)} mm active</div>
        </div>
        <div className="seg-list">
          {project.segments.map((seg, i) => {
            const res = result.segments.find((r) => r.segmentId === seg.id);
            const tone = !seg.enabled ? 'gray' : !res ? 'warn' : res.errors.length ? 'err' : res.warnings.length ? 'warn' : 'ok';
            return (
              <div
                key={seg.id}
                className={`seg-item ${seg.id === selectedId ? 'selected' : ''}`}
                onClick={() => onSelect(seg.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelect(seg.id); }}
                style={{ opacity: seg.enabled ? 1 : 0.55 }}
              >
                <div className="seg-top">
                  <span className="seg-dot" style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="seg-name nowrap-ellipsis">{seg.name}</div>
                    <div className="seg-spec">⌀{seg.outerTube.od.toFixed(2)} / {seg.innerTube.od.toFixed(2)} mm · {seg.activeLength.toFixed(0)} mm</div>
                  </div>
                  <span className={`status-dot ${tone}`} style={{ marginTop: 3 }} title={tone === 'ok' ? 'Designed' : tone === 'err' ? 'Errors' : tone === 'warn' ? 'Warnings' : 'Not designed'} />
                </div>
                <div className="seg-tags">
                  <span className="chip gray" style={{ height: 17, fontSize: 9 }}>{seg.cutType === 'chord' ? 'chord' : 'radial'}</span>
                  <span className="chip gray" style={{ height: 17, fontSize: 9 }}>{seg.notches} notches</span>
                  {res && res.qDesign > 0 && <span className="chip info" style={{ height: 17, fontSize: 9 }}>q {res.qDesign.toFixed(1)}</span>}
                  {seg.rollDeg !== 0 && <span className="chip gray" style={{ height: 17, fontSize: 9 }}>roll {seg.rollDeg}°</span>}
                </div>
                {seg.id === selectedId && (
                  <div className="seg-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn xs ghost" disabled={i === 0} onClick={() => onMove(seg.id, -1)}><Icon name="arrowUp" className="sm" /> Up</button>
                    <button type="button" className="btn xs ghost" disabled={i === project.segments.length - 1} onClick={() => onMove(seg.id, 1)}><Icon name="arrowDown" className="sm" /> Down</button>
                    <div className="grow" />
                    <button type="button" className="btn xs ghost" onClick={() => onDelete(seg.id)} disabled={project.segments.length <= 1}><Icon name="trash" className="sm" /></button>
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="add-seg" onClick={onAdd}><Icon name="plus" className="sm" /> Add distal segment</button>
        </div>

        <div className="left-section">
          <div className="panel-title" style={{ marginBottom: 8 }}>Robot summary</div>
          <div className="robot-stats">
            <div className="stat"><div className="v">{result.dof}</div><div className="l">nominal DOF</div></div>
            <div className="stat"><div className="v">{total.toFixed(0)}</div><div className="l">active mm</div></div>
            <div className="stat"><div className="v">{result.segments.reduce((a, s) => a + s.notches.length, 0)}</div><div className="l">notches</div></div>
            <div className="stat"><div className="v">{result.segments.reduce((a, s) => a + s.mass, 0).toFixed(1)}</div><div className="l">grams (active)</div></div>
          </div>
        </div>

        <div className="left-section">
          <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="panel-title">Design checks</span>
            <button type="button" className="btn xs ghost" onClick={onDiagnostics}>Details</button>
          </div>
          {issues.length === 0 ? (
            <div className="callout ok" style={{ fontSize: 11 }}>
              <div className="flex gap6"><Icon name="checkCircle" className="sm" /> All configured segments pass the model checks.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {issues.slice(0, 4).map((it, i) => (
                <div key={i} className={`callout ${it.tone}`} style={{ fontSize: 10.5, padding: '6px 8px' }}>
                  <div className="flex gap6" style={{ alignItems: 'flex-start' }}>
                    <Icon name={it.tone === 'err' ? 'error' : 'alert'} className="sm" />
                    <span className="nowrap-ellipsis" style={{ whiteSpace: 'normal' }}>{it.text}</span>
                  </div>
                </div>
              ))}
              {issues.length > 4 && <button type="button" className="btn xs ghost" onClick={onDiagnostics}>+ {issues.length - 4} more</button>}
            </div>
          )}
        </div>

        <div className="left-section">
          <div className="panel-title" style={{ marginBottom: 8 }}>Get started</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Button size="sm" icon="sparkles" onClick={onExamples}>Load an example</Button>
            <Button size="sm" variant="ghost" icon="book" onClick={onHelp}>How CPPRs work</Button>
          </div>
        </div>

        <div className="footer-note" style={{ marginTop: 'auto' }}>
          <div><b>CPPR Studio</b> · v0.1</div>
          <div>Planar variable-curvature model after Oliver-Butler et al., IEEE T-RO 2022.</div>
          <div>All computation is local; projects autosave in this browser.</div>
        </div>
      </div>
    </aside>
  );
}
