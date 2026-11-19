import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Project, RobotResult } from '../core/types';
import { assembleRobot } from '../core/design/robot';
import { buildCosseratAssembly } from '../core/cosserat/assembly';
import { buildSegmentTubes, type TubeBuild } from '../core/fab/build';
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
      const liveGroup = robotGroupRef.current;
      if (liveGroup && liveGroup.children.length) box.setFromObject(liveGroup);
      if (box.isEmpty()) {
        for (const p of current.worldShape) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
      }
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
      const selected = cfg.id === selectedSegmentId;
      const pts: THREE.Vector3[] = seg.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      if (pts.length < 2) return;
      const res = result.segments.find((r) => r.segmentId === cfg.id);
      if (!res) return;
      const fab = buildSegmentTubes(cfg, res, { includeTransmission: true });
      const colorBase = new THREE.Color(COLORS[idx % COLORS.length]);
      const basePos = new THREE.Vector3(seg.base.position[0], seg.base.position[1], seg.base.position[2]);
      const baseQ = new THREE.Quaternion(seg.base.quaternion[0], seg.base.quaternion[1], seg.base.quaternion[2], seg.base.quaternion[3]).normalize();
      const baseT = new THREE.Vector3(0, 0, 1).applyQuaternion(baseQ).normalize();
      const baseN = new THREE.Vector3(1, 0, 0).applyQuaternion(baseQ).normalize();
      const cum: number[] = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const frames: { s: number; p: THREE.Vector3; T: THREE.Vector3; N: THREE.Vector3; B: THREE.Vector3 }[] = [];
      let prevT = baseT.clone();
      let transportedN = baseN.clone();
      for (let i = 0; i < pts.length; i++) {
        const T = i === 0 ? baseT.clone() : pts[i].clone().sub(pts[i - 1]).normalize();
        if (i > 0) {
          const q = new THREE.Quaternion().setFromUnitVectors(prevT, T);
          transportedN.applyQuaternion(q);
        }
        transportedN.sub(T.clone().multiplyScalar(transportedN.dot(T))).normalize();
        const B = new THREE.Vector3().crossVectors(T, transportedN).normalize();
        frames.push({ s: cum[i], p: pts[i].clone(), T, N: transportedN.clone(), B });
        prevT = T;
      }
      const frameAt = (s: number) => {
        const clamped = Math.max(0, Math.min(cum[cum.length - 1], s));
        let j = 1;
        while (j < frames.length - 1 && frames[j].s < clamped) j++;
        const a = frames[j - 1];
        const b = frames[j] ?? a;
        const w = b.s > a.s ? (clamped - a.s) / (b.s - a.s) : 0;
        return {
          p: a.p.clone().lerp(b.p, w),
          T: a.T.clone().lerp(b.T, w).normalize(),
          N: a.N.clone().lerp(b.N, w).normalize(),
          B: a.B.clone().lerp(b.B, w).normalize(),
        };
      };
      const makeDeformed = (tube: TubeBuild, activeBase: number) => {
        const pos = tube.mesh.positions;
        const out = new Float32Array(pos.length);
        const colors = new Float32Array(pos.length);
        const dark = colorBase.clone().multiplyScalar(0.72).lerp(new THREE.Color('#334155'), 0.18);
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i];
          const y = pos[i + 1];
          const z = pos[i + 2];
          let world: THREE.Vector3;
          let c = colorBase;
          if (z <= activeBase) {
            world = new THREE.Vector3(x, y, z - activeBase).applyQuaternion(baseQ).add(basePos);
            c = dark;
          } else if (z <= activeBase + res.activeTubeLength) {
            const f = frameAt(z - activeBase);
            world = f.p.clone().addScaledVector(f.N, x).addScaledVector(f.B, y);
          } else {
            const last = frames[frames.length - 1];
            const extra = z - (activeBase + res.activeTubeLength);
            world = last.p.clone().addScaledVector(last.T, extra).addScaledVector(last.N, x).addScaledVector(last.B, y);
          }
          out[i] = world.x; out[i + 1] = world.y; out[i + 2] = world.z;
          colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(tube.mesh.triangles), 1));
        geometry.computeVertexNormals();
        const mat = new THREE.MeshPhysicalMaterial({
          vertexColors: true,
          roughness: 0.34,
          metalness: 0.1,
          clearcoat: 0.35,
          clearcoatRoughness: 0.42,
          transparent: !selected,
          opacity: selected ? 1 : 0.42,
          depthWrite: selected,
          envMapIntensity: 1.1,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (selected) {
          const outline = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: colorBase.clone().multiplyScalar(0.35), side: THREE.BackSide, transparent: true, opacity: 0.22 }),
          );
          outline.scale.setScalar(1.008);
          group.add(outline);
        }
      };
      makeDeformed(fab.outer, fab.outerActiveStart);
      makeDeformed(fab.inner, fab.innerActiveStart);
      const last = frames[frames.length - 1];
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.2, cfg.innerTube.od / 2), 16, 12),
        new THREE.MeshStandardMaterial({ color: colorBase, roughness: 0.4, metalness: 0.1, transparent: !selected, opacity: selected ? 1 : 0.5 }),
      );
      tip.position.copy(last.p);
      tip.castShadow = true;
      group.add(tip);
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
          <span><span className="swatch" style={{ background: '#1e293b' }} />actual notched tube</span>
          <span className="faint">transmission grooves + notch cuts · ghosted tubes are unselected</span>
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
