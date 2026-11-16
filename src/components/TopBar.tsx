import { useEffect, useState } from 'react';
import type { Project, RobotResult } from '../core/types';
import { Button, Icon } from './ui';

interface Props {
  project: Project;
  result: RobotResult;
  designing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onRename: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExamples: () => void;
  onHelp: () => void;
  onImport: () => void;
  onFabricate: () => void;
}

export function TopBar(props: Props) {
  const { project, result, designing, canUndo, canRedo, onRename, onUndo, onRedo, onExamples, onHelp, onImport, onFabricate } = props;
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);
  const issues = result.errors.length + result.warnings.length;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <defs>
              <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#60a5fa" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
            <path d="M5 21C5 15 8.5 15 8.5 10.5S12 4 12 4s3.5 2 3.5 6.5S19 15 19 21" stroke="url(#bm)" strokeWidth="2.6" strokeLinecap="round" />
            <path d="M6.4 18.5h3M14.6 18.5h3M8 14h2.4M13.6 14h2.4M10.6 9.5h2.8" stroke="#dbeafe" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
          </svg>
        </div>
        <div>
          <div className="brand-name">CPPR Studio</div>
          <div className="brand-sub">concentric push–pull robot designer</div>
        </div>
      </div>
      <div className="topbar-sep" />
      <input
        className="project-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name !== project.name) onRename(name.trim()); else setName(project.name); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label="Project name"
      />
      <div className="topbar-status">
        <span className={`status-dot ${designing ? 'warn' : result.ok ? 'ok' : 'err'}`} />
        <span>{designing ? 'Solving…' : result.ok ? `Design ready${issues ? ` · ${issues} note${issues === 1 ? '' : 's'}` : ''}` : `${result.errors.length} blocking issue${result.errors.length === 1 ? '' : 's'}`}</span>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <button type="button" className="tbtn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
        <button type="button" className="tbtn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>
        <span className="topbar-sep" />
        <button type="button" className="tbtn" onClick={onExamples}><Icon name="sparkles" /> Examples</button>
        <button type="button" className="tbtn" onClick={onHelp}><Icon name="help" /> Guide</button>
        <button type="button" className="tbtn" title="Import a CPPR Studio project JSON" onClick={onImport}><Icon name="upload" /></button>
        <Button variant="primary" icon="package" onClick={onFabricate}>Fabricate</Button>
      </div>
    </header>
  );
}
