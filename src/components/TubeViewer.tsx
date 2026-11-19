import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SegmentConfig, SegmentResult } from '../core/types';
import { buildSegmentTubes, type SegmentFab, type TubeBuild } from '../core/fab/build';
import { effectiveTransmissionPattern } from '../core/fab/transmission';
import { Icon } from './ui';

type TubeChoice = 'both' | 'outer' | 'inner';
type PreviewMode = 'complete' | 'tip';

const SECTION = {
  handle: '#a78bfa',
  solid: '#94a3b8',
  flex: '#60a5fa',
  gap: '#cbd5e1',
  active: '#fb923c',
  tip: '#10b981',
};

// THREE.Color already converts CSS sRGB values to the linear working space.
const C = {
  handle: new THREE.Color(SECTION.handle),
  solid: new THREE.Color(SECTION.solid),
  flex: new THREE.Color(SECTION.flex),
  gap: new THREE.Color(SECTION.gap),
  active: new THREE.Color(SECTION.active),
  tip: new THREE.Color(SECTION.tip),
};

const CYCLIC = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

interface Props {
  cfg: SegmentConfig;
  res: SegmentResult | undefined;
  designing?: boolean;
  theme?: 'light' | 'dark';
}

export function TubeViewer({ cfg, res, designing = false, theme = 'light' }: Props) {
  const [tube, setTube] = useState<TubeChoice>('both');
  const [mode, setMode] = useState<PreviewMode>('complete');
  const [autoRotate, setAutoRotate] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [focusTip, setFocusTip] = useState(false);
  const [fab, setFab] = useState<SegmentFab | null>(null);
  const [pending, setPending] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const hasBuilt = useRef(false);
  const lastBuildKey = useRef('');

  useEffect(() => {
    setFitNonce((n) => n + 1);
  }, [tube]);

  useEffect(() => {
    if (!res) {
      setFab(null);
      setPending(false);
      return;
    }
    setPending(true);
    const delay = hasBuilt.current ? 170 : 0;
    const timer = window.setTimeout(() => {
      try {
        const next = buildSegmentTubes(cfg, res, { includeTransmission: mode === 'complete' });
        setFab(next);
        hasBuilt.current = true;
        setBuildError(null);
        const structural = `${cfg.id}|${mode}`;
        if (structural !== lastBuildKey.current) {
          lastBuildKey.current = structural;
          setFitNonce((n) => n + 1);
        }
      } catch (e) {
        setBuildError(e instanceof Error ? e.message : 'Could not build the tube mesh.');
      } finally {
        setPending(false);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [cfg, res, mode]);

  const txLength = mode === 'complete' ? cfg.transmission.length : 0;
  const handle = mode === 'complete' ? Math.max(0, fab?.innerExtension ?? cfg.innerExtension ?? 0) : 0;
  const outerHandle = mode === 'complete' ? Math.max(0, fab?.outerExtension ?? cfg.outerExtension ?? 0) : 0;
  const outerFlex = effectiveTransmissionPattern(cfg, 'outer') !== 'solid';
  const innerFlex = effectiveTransmissionPattern(cfg, 'inner') !== 'solid';
  const error = res?.errors[0] ?? buildError ?? canvasError;

  if (!cfg.enabled) {
    return (
      <div className="tube-viewer">
        <div className="tube-empty">
          <div>
            <Icon name="layers" size={26} />
            <div className="faint" style={{ marginTop: 8 }}>This segment is disabled. Enable it in the left rail to preview the printable tubes.</div>
          </div>
        </div>
      </div>
    );
  }

  if (!res) {
    return (
      <div className="tube-viewer">
        <div className="tube-empty">
          <div>
            {designing ? <div className="spinner" /> : <Icon name="alert" size={26} />}
            <div className="faint" style={{ marginTop: 8 }}>
              {designing ? 'Waiting for the design…' : 'No design result for this segment. Check the design checks.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tube-viewer">
      <TubeCanvas
        fab={fab}
        cfg={cfg}
        tube={tube}
        autoRotate={autoRotate}
        fitNonce={fitNonce}
        focusTip={focusTip}
        onError={setCanvasError}
        theme={theme}
      />

      <div className="tube-toolbar">
        <div className="tube-card">
          <span className="tiny faint">Tubes</span>
          <div className="btn-group">
            {(['both', 'outer', 'inner'] as const).map((t) => (
              <button key={t} type="button" className={`btn sm ${tube === t ? 'on' : ''}`} onClick={() => setTube(t)}>
                {t === 'both' ? 'Both' : t === 'outer' ? 'Outer' : 'Inner'}
              </button>
            ))}
          </div>
          <span className="tiny faint">Geometry</span>
          <div className="btn-group">
            {(['complete', 'tip'] as const).map((m) => (
              <button key={m} type="button" className={`btn sm ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
                {m === 'complete' ? 'Complete' : 'Tip only'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`btn sm ${autoRotate ? 'primary' : 'ghost'}`}
            onClick={() => setAutoRotate((v) => !v)}
            title="Rotate the view automatically"
          >
            <Icon name="rotate" className="sm" /> Rotate
          </button>
          <button type="button" className="btn sm ghost" onClick={() => { setFocusTip(false); setFitNonce((n) => n + 1); }} title="Fit the tubes in view">
            <Icon name="maximize" className="sm" /> Fit
          </button>
          {cfg.tipFeature?.enabled && (
            <button
              type="button"
              className={`btn sm ${focusTip ? 'primary' : 'ghost'}`}
              onClick={() => { setFocusTip(true); setFitNonce((n) => n + 1); }}
              title="Zoom to the cross-pin hole"
            >
              <Icon name="target" className="sm" /> Pin
            </button>
          )}
          {(pending || designing) && <span className="chip info">Updating preview…</span>}
        </div>
        <div className="tube-card tube-exploded">
          <Icon name="layers" className="sm" /> Exploded · inner above outer · active tips aligned
        </div>
      </div>

      <div className="tube-legend">
        <div className="tube-legend-title">
          {cfg.name} · {mode === 'complete' ? 'complete tube' : 'tip only'}
        </div>
        <div className="tube-section-dims">
          <div className="tube-row">
            <span className="tube-tube-label">Outer</span>
            {outerHandle > 0 && (
              <>
                <span className="tube-swatch" style={{ background: SECTION.handle }} />
                {outerHandle} mm solid ext
                <span className="tube-sep">·</span>
              </>
            )}
            <span className="tube-swatch" style={{ background: outerFlex ? SECTION.flex : SECTION.solid }} />
            {txLength.toFixed(0)} mm {outerFlex ? 'flex' : 'solid'}
            <span className="tube-sep">·</span>
            <span className="tube-swatch" style={{ background: SECTION.active }} />
            {res?.activeTubeLength.toFixed(0) ?? '—'} mm active
            {cfg.tipFeature?.enabled && (
              <>
                <span className="tube-sep">·</span>
                <span className="tube-swatch" style={{ background: SECTION.tip }} />
                {cfg.tipFeature.extension.toFixed(0)} mm tip pin
              </>
            )}
            <span className="tube-sep">·</span>
            <span className="faint">⌀{cfg.outerTube.od.toFixed(1)} · {fab ? fab.outer.totalLength.toFixed(0) : '—'} mm</span>
          </div>
          <div className="tube-row">
            <span className="tube-tube-label">Inner</span>
            {handle > 0 && (
              <>
                <span className="tube-swatch" style={{ background: SECTION.handle }} />
                {handle} mm handle
                <span className="tube-sep">·</span>
              </>
            )}
            <span className="tube-swatch" style={{ background: innerFlex ? SECTION.flex : SECTION.solid }} />
            {txLength.toFixed(0)} mm {innerFlex ? 'flex' : 'solid'}
            <span className="tube-sep">·</span>
            <span className="tube-swatch" style={{ background: SECTION.active }} />
            {res?.activeTubeLength.toFixed(0) ?? '—'} mm active
            {cfg.tipFeature?.enabled && (
              <>
                <span className="tube-sep">·</span>
                <span className="tube-swatch" style={{ background: SECTION.tip }} />
                {cfg.tipFeature.extension.toFixed(0)} mm tip pin
              </>
            )}
            <span className="tube-sep">·</span>
            <span className="faint">⌀{cfg.innerTube.od.toFixed(1)} · {fab ? fab.inner.totalLength.toFixed(0) : '—'} mm</span>
          </div>
          <div className="faint">
            {fab ? (fab.outer.transmissionCuts + fab.inner.transmissionCuts) : 0} transmission slots · distal tips aligned · handle left / active tip right · drag to orbit, scroll to zoom
          </div>
        </div>
      </div>

      {error && (
        <div className="tube-error">
          <Icon name="alert" className="sm" /> {error}
        </div>
      )}
      {!fab && !error && (
        <div className="tube-empty">
          <div>
            <div className="spinner" />
            <div className="faint">Building printable tube preview…</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* three.js canvas                                                     */
/* ------------------------------------------------------------------ */

interface CanvasProps {
  fab: SegmentFab | null;
  cfg: SegmentConfig;
  tube: TubeChoice;
  autoRotate: boolean;
  fitNonce: number;
  focusTip: boolean;
  onError: (message: string) => void;
  theme: 'light' | 'dark';
}

interface ViewerState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  fit: () => void;
}

function TubeCanvas({ fab, cfg, tube, autoRotate, fitNonce, focusTip, onError, theme }: CanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewerState | null>(null);
  const lastFit = useRef('');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onError('WebGL is not available in this browser, so the live preview cannot render.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(160, -220, 160);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 1.1;
    controls.autoRotateSpeed = 0.75;
    controls.target.set(0, 0, 10);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x93a4bb, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(140, -180, 260);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.9);
    fill.position.set(-160, 140, 90);
    scene.add(fill);

    const dark = theme === 'dark';
    const grid = new THREE.GridHelper(600, 60, dark ? 0x2b3d59 : 0xc7d2e2, dark ? 0x17253a : 0xe2e8f0);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.z = -0.02;
    scene.add(grid);

    const content = new THREE.Group();
    scene.add(content);

    const fit = () => {
      const groups = content.children.filter((c) => c.visible);
      if (!groups.length) return;
      content.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const g of groups) box.expandByObject(g);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const r = Math.max(5, sphere.radius);
      const dir = new THREE.Vector3(0.3, -1.65, 1.15).normalize();
      const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
      const half = Math.min(vHalf, hHalf);
      const distance = (r / Math.sin(half)) * 1.16;
      controls.target.copy(center);
      camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
      camera.near = Math.max(0.04, r * 0.012);
      camera.far = Math.max(200, r * 70);
      camera.updateProjectionMatrix();
      controls.update();
    };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w < 10 || h < 10) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    stateRef.current = { renderer, scene, camera, controls, content, fit };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m?.dispose();
      });
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    // remove previous tube groups
    while (state.content.children.length) {
      const child = state.content.children.pop()!;
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m?.dispose();
      });
    }

    if (fab) {
      const maxLen = Math.max(fab.outer.totalLength, fab.inner.totalLength);
      const both = tube === 'both';
      const stackGap = Math.max(8, fab.outer.od * 0.45);
      const outerZ = fab.outer.od / 2;
      const innerZ = both
        ? fab.outer.od + stackGap + fab.inner.od / 2
        : fab.inner.od / 2;
      const outer = createTubeGroup(fab.outer, cfg, fab, 'outer', maxLen, outerZ);
      const inner = createTubeGroup(fab.inner, cfg, fab, 'inner', maxLen, innerZ);
      outer.visible = tube !== 'inner';
      inner.visible = tube !== 'outer';
      state.content.add(outer, inner);
    }

    const key = `${tube}|${fitNonce}`;
    if (key !== lastFit.current) {
      if (focusTip && fab && cfg.tipFeature?.enabled) {
        const R = cfg.outerTube.od / 2;
        const holeDist = cfg.tipFeature.holeDistance;
        const maxLen = Math.max(fab.outer.totalLength, fab.inner.totalLength);
        const targetGroup = state.content.children[tube === 'inner' ? 1 : 0] as THREE.Group | undefined;
        const centerZ = targetGroup?.position.z ?? R;
        const theta = (cfg.tipFeature.angleDeg * Math.PI) / 180;
        const holeAxis = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
        const target = new THREE.Vector3(maxLen - holeDist, 0, centerZ);
        const dir = holeAxis.clone().multiplyScalar(1.25)
          .add(new THREE.Vector3(0.35, -0.35, 0.2)).normalize();
        const radius = Math.max(cfg.outerTube.od * 1.2, 12);
        state.controls.target.copy(target);
        state.camera.position.copy(target.clone().add(dir.multiplyScalar(radius * 2.4)));
        state.camera.near = 0.04;
        state.camera.far = 2000;
        state.camera.updateProjectionMatrix();
        state.controls.update();
      } else {
        state.fit();
      }
      lastFit.current = key;
    }
  }, [fab, cfg, tube, fitNonce, focusTip]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  return <div ref={mountRef} className="tube-canvas" />;
}

function createTubeGroup(
  tube: TubeBuild,
  cfg: SegmentConfig,
  fab: SegmentFab,
  which: 'outer' | 'inner',
  maxLen: number,
  stackZ: number,
): THREE.Group {
  const positions = new Float32Array(tube.mesh.positions);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(tube.mesh.triangles), 1));

  const ext = which === 'inner' ? fab.innerExtension : fab.outerExtension;
  const activeStart = which === 'inner' ? fab.innerActiveStart : fab.outerActiveStart;
  const transEnd = Math.max(ext, activeStart - fab.leadIn);
  const flex = effectiveTransmissionPattern(cfg, which) !== 'solid';
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const z = positions[i + 2];
    let color: THREE.Color;
    if (cfg.tipFeature?.enabled && tube.tipExtension > 0 && z > tube.totalLength - tube.tipExtension + 1e-6) color = C.tip;
    else if (z < ext - 1e-6) color = C.handle;
    else if (z < transEnd - 1e-6) color = flex ? C.flex : C.solid;
    else if (z < activeStart - 1e-6) color = C.gap;
    else color = C.active;
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.applyMatrix4(CYCLIC);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.56,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  // raw +z (tube length) became +x; raw +y became +z. Rest the tube on z=0
  // (or stack the inner above the outer in the exploded view).
  group.position.set(maxLen - tube.totalLength, 0, stackZ);
  return group;
}
