import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Material, Project, SegmentConfig } from './core/types';
import { designProject } from './core/design/robot';
import { cloneSegment, defaultShape, defaultTipFeature, defaultTransmission, makeSegment, newProject } from './core/defaults';
import { normalizeProject, useProject } from './state/useProject';
import { buildLaserPatterns, patternToDxf, patternToSvg } from './core/fab/patterns';
import { downloadText, slugify } from './lib/files';
import { TopBar } from './components/TopBar';
import { useTheme } from './state/useTheme';
import { LeftPanel } from './components/LeftPanel';
import { Inspector } from './components/Inspector';
import { ShapeView } from './components/ShapeView';
import { Robot3D } from './components/Robot3D';
import { CrossSectionView } from './components/CrossSectionView';
import { CompareView } from './components/CompareView';
import { PatternView } from './components/PatternView';
import { FabricateView } from './components/FabricateView';
import { TubeViewer } from './components/TubeViewer';
import { BottomPanel } from './components/BottomPanel';
import { StiffnessPanel } from './components/StiffnessPanel';
import { HelpModal } from './components/HelpModal';
import { ExamplesModal } from './components/ExamplesModal';
import { Icon, useDebounced } from './components/ui';
import { solveCosserat, type CosseratResult, type SolverMode } from './core/cosserat/solver';
import { solveTipStiffness, tipForceVector, type TipForce, type TipStiffnessResult } from './core/cosserat/stiffness';

type View = 'shape' | 'robot' | 'stiffness' | 'compare' | 'section' | 'pattern' | 'tube' | 'fabricate';
type BottomTab = 'notches' | 'charts' | 'diagnostics';

const VIEWS: { id: View; label: string; short: string; icon: string }[] = [
  { id: 'shape', label: 'Shape', short: 'Shape', icon: 'spline' },
  { id: 'robot', label: '3D robot', short: '3D', icon: 'cube' },
  { id: 'stiffness', label: 'Tip stiffness', short: 'Stiff', icon: 'gauge' },
  { id: 'compare', label: 'Compare models', short: 'Compare', icon: 'chart' },
  { id: 'section', label: 'Cross-section', short: 'Section', icon: 'crosshair' },
  { id: 'pattern', label: 'Laser pattern', short: 'Pattern', icon: 'zap' },
  { id: 'tube', label: 'STL preview', short: 'STL', icon: 'layers' },
  { id: 'fabricate', label: 'Fabricate', short: 'Build', icon: 'package' },
];

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { project, setProject, replaceProject, undo, redo, canUndo, canRedo } = useProject();
  const [selectedId, setSelectedId] = useState(() => project.segments[0]?.id ?? '');
  const [view, setView] = useState<View>('shape');
  const [bottomTab, setBottomTab] = useState<BottomTab>('notches');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [bottomHeight, setBottomHeight] = useState(232);
  const [fraction, setFraction] = useState(1);
  const [solverMode, setSolverMode] = useState<SolverMode>('analytic');
  const [gravityEnabled, setGravityEnabled] = useState(false);
  const [tipForce, setTipForce] = useState<TipForce>({ magnitude: 0.1, azimuthDeg: 0, elevationDeg: 0 });
  const [stiffnessPlanar, setStiffnessPlanar] = useState(true);
  const [stiffness, setStiffness] = useState<TipStiffnessResult | null>(null);
  const [stiffnessPending, setStiffnessPending] = useState(false);
  const [stiffnessError, setStiffnessError] = useState<string | null>(null);
  const [cosseratPlanar, setCosseratPlanar] = useState(true);
  const [cosserat, setCosserat] = useState<CosseratResult | null>(null);
  const [cosseratPending, setCosseratPending] = useState(false);
  const [cosseratError, setCosseratError] = useState<string | null>(null);
  const [notchIndex, setNotchIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const designInput = useDebounced(project, 90);
  const result = useMemo(() => designProject(designInput), [designInput]);
  const designing = designInput !== project;

  useEffect(() => {
    if (view !== 'robot' || solverMode !== 'cosserat') {
      setCosserat(null);
      setCosseratPending(false);
      setCosseratError(null);
      return;
    }
    if (!result.ok) {
      setCosserat(null);
      setCosseratPending(false);
      setCosseratError('Fix the design checks before running the Cosserat solver.');
      return;
    }
    let cancelled = false;
    setCosseratPending(true);
    setCosseratError(null);
    const timer = window.setTimeout(() => {
      solveCosserat(designInput, result, { fraction, gravityEnabled, planar: cosseratPlanar })
        .then((solved) => {
          if (cancelled) return;
          setCosserat(solved);
          setCosseratPending(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setCosserat(null);
          setCosseratPending(false);
          setCosseratError(error instanceof Error ? error.message : String(error));
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, solverMode, designInput, result, fraction, gravityEnabled, cosseratPlanar]);

  useEffect(() => {
    if (view !== 'stiffness') return;
    if (!result.ok) {
      setStiffness(null);
      setStiffnessPending(false);
      setStiffnessError('Fix the design checks before calculating tip stiffness.');
      return;
    }
    let cancelled = false;
    setStiffnessPending(true);
    setStiffnessError(null);
    const timer = window.setTimeout(() => {
      solveTipStiffness(designInput, result, { fraction, gravityEnabled, plan2d: stiffnessPlanar, force: tipForce })
        .then((solved) => {
          if (cancelled) return;
          setStiffness(solved);
          setStiffnessPending(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setStiffnessPending(false);
          setStiffnessError(e instanceof Error ? e.message : 'Tip-load solve failed.');
        });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, designInput, result, fraction, gravityEnabled, stiffnessPlanar, tipForce]);

  const tipArrow = useMemo(
    () => ({ vector: stiffness?.forceVector ?? tipForceVector(tipForce), magnitude: tipForce.magnitude }),
    [stiffness, tipForce],
  );


  const selected: SegmentConfig =
    project.segments.find((s) => s.id === selectedId) ?? project.segments[0];
  const selectedRes = result.segments.find((r) => r.segmentId === selected?.id);
  // The preview must use the config/result pair that the debounced design was computed from.
  const viewerCfg = designInput.segments.find((s) => s.id === selected?.id) ?? designInput.segments[0];
  const viewerRes = viewerCfg ? result.segments.find((r) => r.segmentId === viewerCfg.id) : undefined;
  const segIndex = project.segments.findIndex((s) => s.id === selected?.id);
  const clampedNotch = Math.max(0, Math.min(notchIndex, (selectedRes?.notches.length ?? 1) - 1));

  useEffect(() => {
    if (!project.segments.some((s) => s.id === selectedId)) {
      setSelectedId(project.segments[0]?.id ?? '');
      setNotchIndex(0);
    }
  }, [project.segments, selectedId]);

  useEffect(() => {
    if (toast) {
      const t = window.setTimeout(() => setToast(null), 4200);
      return () => window.clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?') setHelpOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const notify = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => setToast({ msg, tone }), []);

  const updateSelected = useCallback((patch: Partial<SegmentConfig>, recordHistory = true) => {
    if (!selected) return;
    setProject((p) => ({
      ...p,
      segments: p.segments.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)),
    }), recordHistory);
  }, [selected, setProject]);

  const updateMaterial = useCallback((id: string, patch: Partial<Material>) => {
    setProject((p) => ({ ...p, materials: p.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  }, [setProject]);

  const selectSegment = useCallback((id: string) => {
    setSelectedId(id);
    setNotchIndex(0);
  }, []);

  const addSegment = useCallback(() => {
    setProject((p) => {
      const prev = p.segments[p.segments.length - 1];
      const clearance = Math.max(0.2, prev?.minClearance ?? 0.2);
      const prevInnerId = prev ? prev.innerTube.od - 2 * prev.innerTube.wall : 8;
      const maxOd = prev ? Math.max(2.2, prevInnerId - 2 * clearance) : 8;
      const od = round(Math.min(prev ? prev.outerTube.od * 0.72 : 8, maxOd), 2);
      const wall = round(Math.max(0.15, Math.min(prev ? prev.outerTube.wall * 0.8 : 0.3, od * 0.12)), 3);
      const innerOd = round(Math.max(od * 0.55, od - 2 * wall - 2 * clearance - 0.02), 2);
      const innerWall = round(Math.max(0.12, wall * 0.9), 3);
      const prevRadius = prev && prev.shape.kappaMax > 1e-9 ? 1 / prev.shape.kappaMax : 40;
      const seg = makeSegment({
        name: `Segment ${p.segments.length + 1}`,
        rollDeg: 90,
        activeLength: prev ? Math.max(25, Math.round(prev.activeLength * 0.8)) : 60,
        notches: 10,
        beta: 0.55,
        outerTube: { od, wall, materialId: prev?.outerTube.materialId ?? 'nitinol' },
        innerTube: { od: innerOd, wall: innerWall, materialId: prev?.innerTube.materialId ?? 'nitinol' },
        innerExtension: Math.max(20, (prev?.innerExtension ?? 0) + 25),
        outerExtension: prev?.outerExtension ?? 0,
        tipFeature: prev?.tipFeature?.enabled ? { ...prev.tipFeature } : defaultTipFeature(),
        cutType: prev?.cutType ?? 'chord',
        shape: defaultShape('tipFirst', 1 / Math.max(7, prevRadius * (od / Math.max(1e-6, prev?.outerTube.od ?? od)) * 1.15)),
        safetyFactor: prev?.safetyFactor ?? 1,
        strainLimitOverride: prev?.strainLimitOverride ?? null,
        minBackbone: Math.max(0.15, round(wall * 0.55, 2)),
        maxDepthFrac: prev?.maxDepthFrac ?? 0.95,
        minClearance: clearance,
        transmission: {
          ...defaultTransmission(),
          length: prev ? Math.max(120, Math.round(prev.transmission.length + prev.activeLength * 0.5)) : 200,
          // A newly added distal pair must pass through the existing bends, so it
          // defaults to a flexible transmission even if the proximal handle is solid.
          pattern: 'discrete',
          innerPattern: 'same',
          cutsPerRev: prev?.transmission.cutsPerRev ?? 6,
          kerf: prev?.transmission.kerf ?? 0.08,
          pitch: prev?.transmission.pitch ?? 0.35,
          separationDeg: prev?.transmission.separationDeg ?? 15,
          overlapDeg: prev?.transmission.overlapDeg ?? 15,
          levels: prev?.transmission.levels ?? 6,
          gap: 0,
          riffleDeg: prev?.transmission.riffleDeg ?? 68.75,
          maxCurvature: prev?.transmission.maxCurvature ?? 0.02,
        },
      });
      // The new segment is now the robot's distal end, so move an existing
      // cross-pin extension from the previous last segment to the new one.
      const segments = p.segments.map((s) =>
        s.id === prev?.id && prev?.tipFeature?.enabled
          ? { ...s, tipFeature: { ...s.tipFeature, enabled: false } }
          : s,
      );
      const next = { ...p, segments: [...segments, seg] };
      setSelectedId(seg.id);
      setNotchIndex(0);
      return next;
    });
  }, [setProject]);

  const deleteSegment = useCallback((id: string) => {
    setProject((p) => {
      if (p.segments.length <= 1) return p;
      const idx = p.segments.findIndex((s) => s.id === id);
      const next = p.segments.filter((s) => s.id !== id);
      const fallback = next[Math.max(0, idx - 1)] ?? next[0];
      if (id === selectedId) {
        setSelectedId(fallback.id);
        setNotchIndex(0);
      }
      return { ...p, segments: next };
    });
  }, [setProject, selectedId]);

  const duplicateSegment = useCallback(() => {
    if (!selected) return;
    const copy = cloneSegment(selected, `${selected.name} copy`);
    setProject((p) => {
      const idx = p.segments.findIndex((s) => s.id === selected.id);
      const segments = [...p.segments];
      segments.splice(idx + 1, 0, copy);
      return { ...p, segments };
    });
    setSelectedId(copy.id);
    setNotchIndex(0);
  }, [selected, setProject]);

  const moveSegment = useCallback((id: string, dir: -1 | 1) => {
    setProject((p) => {
      const idx = p.segments.findIndex((s) => s.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= p.segments.length) return p;
      const segments = [...p.segments];
      [segments[idx], segments[j]] = [segments[j], segments[idx]];
      return { ...p, segments };
    });
  }, [setProject]);

  const loadProject = useCallback((p: Project) => {
    replaceProject(p);
    setSelectedId(p.segments[0]?.id ?? '');
    setView('shape');
    setFraction(1);
    setNotchIndex(0);
    setExamplesOpen(false);
    notify(`Loaded “${p.name}”`, 'ok');
  }, [replaceProject, notify]);

  const importProject = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = normalizeProject(JSON.parse(String(reader.result)));
        if (!parsed) throw new Error('Not a CPPR Studio project file.');
        loadProject(parsed);
      } catch (e) {
        notify(`Import failed: ${(e as Error).message}`, 'err');
      }
    };
    reader.readAsText(file);
  }, [loadProject, notify]);

  const exportPatternSvg = useCallback(() => {
    if (!selectedRes || !selected) return;
    const patterns = buildLaserPatterns(selected, selectedRes, true);
    downloadText(`${slugify(project.name)}_${slugify(selected.name)}_pattern.svg`, patternToSvg(patterns, project.name, selected.name), 'image/svg+xml');
    notify('SVG pattern downloaded');
  }, [selected, selectedRes, project.name, notify]);

  const exportPatternDxf = useCallback(() => {
    if (!selectedRes || !selected) return;
    const patterns = buildLaserPatterns(selected, selectedRes, true);
    downloadText(`${slugify(project.name)}_${slugify(selected.name)}_pattern.dxf`, patternToDxf(patterns), 'application/dxf');
    notify('DXF pattern downloaded');
  }, [selected, selectedRes, project.name, notify]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomHeight;
    const move = (ev: PointerEvent) => {
      setBottomHeight(Math.max(120, Math.min(window.innerHeight - 280, startH - (ev.clientY - startY))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fractionState = selectedRes?.sweep.length
    ? selectedRes.sweep.reduce((best, s) => (Math.abs(s.q / Math.max(1e-9, selectedRes.qDesign) - fraction) < Math.abs(best.q / Math.max(1e-9, selectedRes.qDesign) - fraction) ? s : best), selectedRes.sweep[0])
    : null;
  const qLabel = selectedRes ? `${(selectedRes.qDesign * fraction).toFixed(2)} mm` : '—';
  const cosseratStatus = solverMode !== 'cosserat'
    ? null
    : cosseratPending
      ? { tone: 'pending', label: 'solving…', title: 'Solving the Cosserat rod model' }
      : cosseratError
        ? { tone: 'error', label: 'error', title: cosseratError }
        : !cosserat
          ? { tone: 'pending', label: 'waiting…', title: 'Waiting for the design' }
          : cosserat.converged
            ? { tone: 'ok', label: `converged · ${cosserat.iterations} it · ${(cosserat.solveTimeMs / 1000).toFixed(1)} s`, title: `Residual ${cosserat.residual.toExponential(1)}` }
            : { tone: 'warn', label: `best effort · ${cosserat.iterations} it`, title: cosserat.message ?? 'The rod solve did not converge' };

  return (
    <div className="app">
      <TopBar
        project={project}
        result={result}
        designing={designing}
        canUndo={canUndo}
        canRedo={canRedo}
        onRename={(name) => setProject((p) => ({ ...p, name }))}
        onUndo={undo}
        onRedo={redo}
        onExamples={() => setExamplesOpen(true)}
        onHelp={() => setHelpOpen(true)}
        onImport={() => fileInput.current?.click()}
        onFabricate={() => setView('fabricate')}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="main">
        <LeftPanel
          project={project}
          result={result}
          selectedId={selected?.id ?? ''}
          onSelect={selectSegment}
          onAdd={addSegment}
          onDuplicate={duplicateSegment}
          onDelete={deleteSegment}
          onMove={moveSegment}
          onExamples={() => setExamplesOpen(true)}
          onHelp={() => setHelpOpen(true)}
          onDiagnostics={() => { setBottomTab('diagnostics'); setBottomOpen(true); }}
        />
        <div className="center">
          <div className="view-tabs">
            <div className="viewtab-wrap tab-scroll">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" title={v.label} className={`view-tab tab-${v.id} ${view === v.id ? 'on' : ''}`} onClick={() => setView(v.id)}>
                  <Icon name={v.icon} className="sm" /> <span className="tab-label-full">{v.label}</span><span className="tab-label-short">{v.short}</span>
                </button>
              ))}
            </div>
          </div>

          {(view === 'shape' || view === 'robot' || view === 'stiffness') && (
            <div className="context-bar">
              <div className="view-tools">
                {view === 'robot' && solverMode === 'cosserat' && cosseratStatus && (
                  <span className={`solver-chip ${cosseratStatus.tone}`} title={cosseratStatus.title}>
                    <span className="solver-dot" /> Cosserat · {cosseratStatus.label}
                  </span>
                )}
                {(view === 'shape' || view === 'robot' || view === 'stiffness') && (
                    <div className="actuation" title="Actuation preview: negative pushes the inner tube, positive pulls it">
                      <span className="lbl">Actuation</span>
                      <input
                        className="range"
                        type="range"
                        min={-0.6}
                        max={1.2}
                        step={0.15}
                        value={fraction}
                        onChange={(e) => setFraction(Number(e.target.value))}
                        aria-label="Actuation preview"
                      />
                      <span className="val">{qLabel}</span>
                      <button type="button" className="btn xs ghost" onClick={() => setFraction(1)} title="Return to the design actuation">Design</button>
                    </div>
                  )}
                  {view === 'shape' && (
                    <>
                      <button
                        type="button"
                        className={`btn icon sm ${project.settings.showActuationFan ? 'primary' : 'ghost'}`}
                        title="Show actuation sweep"
                        onClick={() => setProject((p) => ({ ...p, settings: { ...p.settings, showActuationFan: !p.settings.showActuationFan } }))}
                      ><Icon name="eye" className="sm" /></button>
                      <button
                        type="button"
                        className={`btn icon sm ${project.settings.colourByStrain ? 'primary' : 'ghost'}`}
                        title="Colour the shape by notch strain"
                        onClick={() => setProject((p) => ({ ...p, settings: { ...p.settings, colourByStrain: !p.settings.colourByStrain } }))}
                      ><Icon name="zap" className="sm" /></button>
                    </>
                  )}
                  {view === 'stiffness' && (
                    <span className="solver-chip info" title="Full 3D Cosserat chain with an external tip force">
                      <span className="solver-dot" /> Cosserat 3D · tip load
                    </span>
                  )}
                  {fractionState && !fractionState.converged && (view === 'shape' || view === 'robot' || view === 'stiffness') && (
                    <span className="chip warn" title="The solver reached the self-contact / workspace boundary">boundary</span>
                  )}
              </div>
            </div>
          )}

          <div className="viewport">
            {view === 'shape' && (
              <ShapeView
                cfg={selected}
                res={selectedRes}
                fraction={fraction}
                notchIndex={clampedNotch}
                onSelectNotch={(i) => { setNotchIndex(i); }}
                onWaypoints={(pts) => updateSelected({ shape: { ...selected.shape, kind: 'waypoints', waypoints: pts } }, false)}
                showFan={project.settings.showActuationFan}
                colourByStrain={project.settings.colourByStrain}
              />
            )}
            {view === 'robot' && (
              <Robot3D
                project={project}
                result={result}
                fraction={fraction}
                selectedSegmentId={selected?.id ?? ''}
                onSelectSegment={selectSegment}
                solverMode={solverMode}
                cosserat={cosserat}
                theme={theme}
              />
            )}
            {view === 'stiffness' && (
              <Robot3D
                project={project}
                result={result}
                fraction={fraction}
                selectedSegmentId={selected?.id ?? ''}
                onSelectSegment={selectSegment}
                solverMode="cosserat"
                cosserat={stiffness?.loaded ?? null}
                theme={theme}
                tipForce={tipArrow}
                baselineTip={stiffness?.baselineTip}
                baselineShape={stiffness?.baseline.centerline}
              />
            )}
            {view === 'compare' && (
              <CompareView
                project={project}
                result={result}
                selected={selected}
                res={selectedRes}
                fraction={fraction}
                onFraction={setFraction}
              />
            )}
            {view === 'section' && (
              <CrossSectionView cfg={selected} res={selectedRes} notchIndex={clampedNotch} onSelectNotch={setNotchIndex} />
            )}
            {view === 'pattern' && (
              <PatternView cfg={selected} res={selectedRes} onExportSvg={exportPatternSvg} onExportDxf={exportPatternDxf} />
            )}
            {view === 'tube' && viewerCfg && (
              <TubeViewer cfg={viewerCfg} res={viewerRes} designing={designing} theme={theme} />
            )}
            {view === 'fabricate' && (
              <FabricateView
                project={project}
                result={result}
                onImport={() => fileInput.current?.click()}
                onNew={() => loadProject(newProject())}
                onExamples={() => setExamplesOpen(true)}
              />
            )}
          </div>

          {view !== 'fabricate' && view !== 'tube' && view !== 'compare' && view !== 'stiffness' && (
            <>
              <div className="resize-handle" onPointerDown={startResize} title="Drag to resize the results panel" />
              <BottomPanel
                tab={bottomTab}
                onTab={setBottomTab}
                cfg={selected}
                res={selectedRes}
                project={project}
                result={result}
                selectedNotch={clampedNotch}
                onSelectNotch={setNotchIndex}
                open={bottomOpen}
                onToggleOpen={() => setBottomOpen((o) => !o)}
                height={bottomHeight}
              />
            </>
          )}
        </div>
        {view === 'stiffness' ? (
          <StiffnessPanel
            project={project}
            result={result}
            force={tipForce}
            onForce={(patch) => setTipForce((f) => ({ ...f, ...patch }))}
            stiffness={stiffness}
            pending={stiffnessPending}
            error={stiffnessError}
            gravityEnabled={gravityEnabled}
            onGravityEnabled={setGravityEnabled}
            plan2d={stiffnessPlanar}
            onPlan2d={setStiffnessPlanar}
            fraction={fraction}
          />
        ) : (
          <Inspector
            project={project}
            cfg={selected}
            res={selectedRes}
            onChange={updateSelected}
            onMaterialChange={updateMaterial}
            onDuplicate={duplicateSegment}
            onDelete={() => deleteSegment(selected.id)}
            onMove={(dir) => moveSegment(selected.id, dir)}
            canMoveUp={segIndex > 0}
            canMoveDown={segIndex >= 0 && segIndex < project.segments.length - 1}
            solverMode={solverMode}
            onSolverMode={setSolverMode}
            gravityEnabled={gravityEnabled}
            onGravityEnabled={setGravityEnabled}
            planar={cosseratPlanar}
            onPlanar={setCosseratPlanar}
            cosserat={cosserat}
            cosseratPending={cosseratPending}
            cosseratError={cosseratError}
            showBendingModel={view !== 'compare'}
          />
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importProject(f);
          e.target.value = '';
        }}
      />
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {examplesOpen && <ExamplesModal onClose={() => setExamplesOpen(false)} onLoad={loadProject} />}
      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          <Icon name={toast.tone === 'ok' ? 'checkCircle' : 'error'} className="sm" />
          {toast.msg}
        </div>
      )}
    </div>
  );
}
