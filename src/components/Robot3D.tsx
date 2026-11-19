import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Project, RobotResult } from '../core/types';
import { assembleRobot } from '../core/design/robot';
import { buildCosseratAssembly } from '../core/cosserat/assembly';
import type { CosseratResult, SolverMode } from '../core/cosserat/solver';
import { IconButton } from './ui';

import { SEGMENT_COLORS as COLORS } from '../lib/colors';

interface Props {
  project: Project;
  result: RobotResult;
  fraction: number;
  selectedSegmentId: string;
  onSelectSegment: (id: string) => void;
  solverMode: SolverMode;
  cosserat: CosseratResult | null;
}

export function Robot3D({
  project, result, fraction, selectedSegmentId, onSelectSegment,
  solverMode, cosserat,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const robotGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const axesRef = useRef<THREE.Group | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const viewRef = useRef<((preset: 'iso' | 'front' | 'side' | 'top') => void) | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const analyticAssembly = useMemo(
    () => assembleRobot(project, result.segments, { fraction }),
    [project, result.segments, fraction],
  );
  const cosseratAssembly = useMemo(
    () => (solverMode === 'cosserat' && cosserat ? buildCosseratAssembly(project, result, cosserat) : null),
    [solverMode, cosserat, project, result],
  );
  const assembly = cosseratAssembly ?? analyticAssembly;
  const assemblyRef = useRef(assembly);
  assemblyRef.current = assembly;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      setError('WebGL is not available in this browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    envScene.dispose();
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(80, -110, 70);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 1.1;
    controls.target.set(0, 0, 30);
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8fa4bb, 0.8);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(130, -170, 250);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -300;
    key.shadow.camera.right = 300;
    key.shadow.camera.top = 300;
    key.shadow.camera.bottom = -300;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 900;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    const keyTarget = new THREE.Object3D();
    keyTarget.position.set(0, 0, 40);
    scene.add(keyTarget);
    key.target = keyTarget;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 1.25);
    fill.position.set(-160, 140, 90);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-180, 130, 210);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(340, 72),
      new THREE.ShadowMaterial({ color: 0x0f172a, opacity: 0.18 }),
    );
    ground.position.z = -0.12;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(400, 40, 0xb8c6d8, 0xdde6f0);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.38;
    gridRef.current = grid;
    scene.add(grid);

    const axes = new THREE.Group();
    const mkAxis = (dir: THREE.Vector3, color: number) => {
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 14, color, 4, 2.5);
      axes.add(arrow);
    };
    mkAxis(new THREE.Vector3(1, 0, 0), 0xef4444);
    mkAxis(new THREE.Vector3(0, 1, 0), 0x22c55e);
    mkAxis(new THREE.Vector3(0, 0, 1), 0x3b82f6);
    axesRef.current = axes;
    scene.add(axes);

    const group = new THREE.Group();
    robotGroupRef.current = group;
    scene.add(group);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.autoRotateSpeed = 1.2;
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

    const setView = (preset: 'iso' | 'front' | 'side' | 'top') => {
      const current = assemblyRef.current;
      if (!current.worldShape.length) return;
      const box = new THREE.Box3();
      for (const p of current.worldShape) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const r = Math.max(8, sphere.radius);
      const dirs = {
        iso: new THREE.Vector3(1.15, -1.6, 0.8),
        front: new THREE.Vector3(0.02, -1.9, 0.22),
        side: new THREE.Vector3(1.9, 0.02, 0.22),
        top: new THREE.Vector3(0.01, 0.01, 2.0),
      };
      const dir = dirs[preset].clone().normalize();
      controls.target.copy(center);
      camera.position.copy(center.clone().add(dir.multiplyScalar(r * 3.15)));
      camera.near = Math.max(0.05, r * 0.01);
      camera.far = r * 40;
      camera.updateProjectionMatrix();
      controls.update();
    };
    const fit = () => setView('iso');
    fitRef.current = fit;
    viewRef.current = setView;
    fit();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m?.dispose();
      });
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      robotGroupRef.current = null;
      gridRef.current = null;
      axesRef.current = null;
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild robot geometry
  useEffect(() => {
    const group = robotGroupRef.current;
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop()!;
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m?.dispose();
    }
    const enabled = project.segments.filter((s) => s.enabled);
    assembly.worldSegments.forEach((seg) => {
      const idx = enabled.findIndex((s) => s.id === seg.segmentId);
      const cfg = enabled[idx];
      if (!cfg) return;
      const color = new THREE.Color(COLORS[idx % COLORS.length]);
      const selected = cfg.id === selectedSegmentId;
      const pts = seg.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      if (pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
      const radius = Math.max(0.15, cfg.outerTube.od / 2);
      const tubeGeo = new THREE.TubeGeometry(curve, Math.max(40, pts.length * 3), radius, 24, false);
      if (selected) {
        const outlineGeo = new THREE.TubeGeometry(curve, Math.max(32, pts.length * 2), radius + Math.max(0.07, radius * 0.035), 16, false);
        const outline = new THREE.Mesh(
          outlineGeo,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(COLORS[idx % COLORS.length]).multiplyScalar(0.42),
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.34,
          }),
        );
        group.add(outline);
      }
      const mat = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.3,
        metalness: 0.12,
        clearcoat: 0.42,
        clearcoatRoughness: 0.38,
        transparent: !selected,
        opacity: selected ? 1 : 0.5,
        depthWrite: selected,
        envMapIntensity: 1.15,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(tubeGeo, mat);
      mesh.userData.segmentId = cfg.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      for (const n of seg.notches) {
        const q = new THREE.Quaternion(n.quaternion[0], n.quaternion[1], n.quaternion[2], n.quaternion[3]);
        const tangent = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 1.006, Math.max(0.07, radius * 0.05), 8, 32),
          new THREE.MeshStandardMaterial({ color: 0x243044, roughness: 0.7, metalness: 0.2 }),
        );
        ring.position.set(n.position[0], n.position[1], n.position[2]);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
        ring.castShadow = true;
        group.add(ring);

        const highlight = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 1.022, Math.max(0.018, radius * 0.011), 6, 32),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 }),
        );
        highlight.position.copy(ring.position);
        highlight.quaternion.copy(ring.quaternion);
        group.add(highlight);
      }

      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.015, 24, 16),
        new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
      );
      tip.position.set(seg.tip[0], seg.tip[1], seg.tip[2]);
      tip.castShadow = true;
      tip.receiveShadow = true;
      group.add(tip);
      const tipTangent = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
      const tipRing = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.04, Math.max(0.02, radius * 0.02), 6, 28),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.3 }),
      );
      tipRing.position.copy(tip.position);
      tipRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tipTangent);
      group.add(tipRing);
    });

    // base disc
    if (enabled.length > 0) {
      const baseGeo = new THREE.CylinderGeometry(
        Math.max(2, enabled[0].outerTube.od * 0.9),
        Math.max(2.4, enabled[0].outerTube.od * 1.1),
        Math.max(1.2, enabled[0].outerTube.od * 0.35),
        32,
      );
      const baseMat = new THREE.MeshPhysicalMaterial({ color: 0x64748b, roughness: 0.42, metalness: 0.28, clearcoat: 0.3 });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.rotation.x = Math.PI / 2;
      base.position.set(0, 0, -Math.max(0.6, enabled[0].outerTube.od * 0.18));
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);
      const bezel = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(2.2, enabled[0].outerTube.od * 1.02), Math.max(0.08, enabled[0].outerTube.od * 0.05), 8, 48),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.5 }),
      );
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(0, 0, -Math.max(0.6, enabled[0].outerTube.od * 0.18) + Math.max(0.5, enabled[0].outerTube.od * 0.2));
      group.add(bezel);
    }
  }, [assembly, project.segments, selectedSegmentId]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = showAxes;
  }, [showAxes]);

  return (
    <div className="canvas-wrap" ref={mountRef}>
      {error && (
        <div className="empty-state"><div className="big">3D preview unavailable</div><p>{error}</p></div>
      )}
      {!error && assembly.worldShape.length === 0 && (
        <div className="empty-state" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div className="big">Nothing to preview yet</div>
          <p>Complete the segment design to see the actuated robot.</p>
        </div>
      )}
      <div className="view-overlay" style={{ pointerEvents: 'none' }}>
        <div className="overlay-card scene-legend">
          {project.segments.filter((s) => s.enabled).map((s, i) => {
            const ss = assembly.worldSegments.find((w) => w.segmentId === s.id);
            return (
              <button
                key={s.id}
                type="button"
                className="item"
                style={{ pointerEvents: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer', opacity: s.id === selectedSegmentId ? 1 : 0.75 }}
                onClick={() => onSelectSegment(s.id)}
              >
                <span className="line" style={{ background: COLORS[i % COLORS.length] }} />
                <span style={{ fontWeight: s.id === selectedSegmentId ? 600 : 400 }}>{s.name}</span>
                <span className="faint">{ss ? `${s.notches} notches` : ''}</span>
                <span className="faint">{`${s.activeLength.toFixed(0)} mm`}</span>
              </button>
            );
          })}
          <div className="item faint" style={{ marginTop: 2 }}>drag to orbit · scroll to zoom</div>
        </div>


      </div>

      <div className="view-note">
        <div className="legend">
          <span><span className="swatch" style={{ background: '#1e293b' }} />notch hinge</span>
          <span className="faint">ghosted tubes are unselected segments</span>
        </div>
        <div className="grow" />
        <div className="scene-viewbar">
          <span className="lbl">View</span>
          <button type="button" className="btn xs ghost" onClick={() => viewRef.current?.('iso')}>Iso</button>
          <button type="button" className="btn xs ghost" onClick={() => viewRef.current?.('front')}>Front</button>
          <button type="button" className="btn xs ghost" onClick={() => viewRef.current?.('side')}>Side</button>
          <button type="button" className="btn xs ghost" onClick={() => viewRef.current?.('top')}>Top</button>
          <span className="sep" />
          <button type="button" className={`btn xs ghost ${showGrid ? 'on' : ''}`} onClick={() => setShowGrid((v) => !v)}>Grid</button>
          <button type="button" className={`btn xs ghost ${showAxes ? 'on' : ''}`} onClick={() => setShowAxes((v) => !v)}>Axes</button>
        </div>
        <IconButton icon="rotate" label={autoRotate ? 'Stop rotation' : 'Auto-rotate'} size="sm" active={autoRotate} onClick={() => setAutoRotate(!autoRotate)} />
        <IconButton icon="target" label="Fit view" size="sm" onClick={() => fitRef.current?.()} />
      </div>
    </div>
  );
}
