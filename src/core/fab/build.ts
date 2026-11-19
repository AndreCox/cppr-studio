import { sectionProps } from '../geometry/section';
import { buildTubeMesh, meshToStlBinary, meshesToStlBinary, type Mesh, type MeshNotch } from './tubeMesh';
import { transmissionDesign } from './transmission';
import { buildTipExtension, mergeMeshes } from './tipFeature';
import type { SegmentConfig, SegmentResult } from '../types';

const TAU = Math.PI * 2;
export const norm2pi = (a: number) => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};

export interface TubeBuild {
  label: string;
  mesh: Mesh;
  notchCount: number;
  transmissionCuts: number;
  /** number of mm added at the distal tip for the cross-pin collar */
  tipExtension: number;
  totalLength: number;
  od: number;
  id: number;
}

export interface SegmentFab {
  outer: TubeBuild;
  inner: TubeBuild;
  /** z coordinate where the outer tube's active (notched) section starts */
  activeStart: number;
  /** outer active start including the solid extension */
  outerActiveStart: number;
  /** z coordinate where the inner tube's active section starts (includes the handle extension) */
  innerActiveStart: number;
  /** solid proximal extension of the inner tube, mm */
  innerExtension: number;
  /** solid proximal extension of the outer tube, mm */
  outerExtension: number;
  leadIn: number;
  /** outer tube total length (transmission + active) */
  totalLength: number;
  /** inner tube total length (handle extension + transmission + active) */
  innerTotalLength: number;
}

const MESH_ANGLE_STEP = Math.PI / 36; // 5° — snapped transmission pattern for printing

/**
 * Snap a transmission slot to the 5° mesh grid so every slot edge coincides
 * with a cylinder vertex. The laser file keeps the exact angles; the printed
 * mesh is a 5° angular approximation (well below the feature size of FDM).
 */
function transmissionMeshNotches(
  cfg: SegmentConfig,
  tube: 'outer' | 'inner',
  radius: number,
): MeshNotch[] {
  const design = transmissionDesign(cfg, tube);
  const out: MeshNotch[] = [];
  for (const c of design.cuts) {
    const start = Math.round((c.angleCenter - c.angleSpan / 2) / MESH_ANGLE_STEP) * MESH_ANGLE_STEP;
    const end = Math.max(
      start + MESH_ANGLE_STEP,
      Math.round((c.angleCenter + c.angleSpan / 2) / MESH_ANGLE_STEP) * MESH_ANGLE_STEP,
    );
    out.push({
      zCenter: 0.5 * (c.z0 + c.z1),
      h: c.z1 - c.z0,
      g: radius * (end - start) / 2,
      cutAngle: 0.5 * (start + end),
      cutType: 'radial',
    });
  }
  return out;
}

export function buildSegmentTubes(
  cfg: SegmentConfig,
  res: SegmentResult,
  opts: { includeTransmission?: boolean } = {},
): SegmentFab {
  const fullTube = opts.includeTransmission !== false;
  const T = fullTube ? Math.max(0, cfg.transmission.length) : 0;
  const coupler = cfg.transmission.coupler;
  const solidEnd = Math.max(0, coupler?.length ?? 0);
  const solidOuter = fullTube && coupler?.enabled && (coupler.tubes === 'outer' || coupler.tubes === 'both') ? solidEnd : 0;
  const solidInner = fullTube && coupler?.enabled && (coupler.tubes === 'inner' || coupler.tubes === 'both') ? solidEnd : 0;
  const outerExtension = fullTube ? Math.max(0, cfg.outerExtension || 0) + solidOuter : 0;
  const innerExtension = fullTube ? Math.max(0, cfg.innerExtension || 0) + solidInner : 0;
  const leadIn = Math.min(3, Math.max(0.5, (res.notches[0]?.c ?? 1) / 2));
  const activeStart = T + leadIn;
  const totalLength = activeStart + res.activeTubeLength;
  const outerActiveStart = outerExtension + activeStart;
  const innerActiveStart = innerExtension + activeStart;
  const outerTotalLength = outerExtension + totalLength;
  const innerTotalLength = innerExtension + totalLength;

  const outerGeom = { od: cfg.outerTube.od, id: cfg.outerTube.od - 2 * cfg.outerTube.wall };
  const innerGeom = { od: cfg.innerTube.od, id: cfg.innerTube.od - 2 * cfg.innerTube.wall };

  const outerNotches: MeshNotch[] = res.notches
    .filter((n) => n.gOuter > 1e-6)
    .map((n) => ({
      zCenter: outerActiveStart + n.zCenter,
      h: n.h,
      g: n.gOuter,
      cutAngle: norm2pi(n.phiOuter - Math.PI),
      cutType: cfg.cutType,
    }));
  const innerNotches: MeshNotch[] = res.notches
    .filter((n) => n.gInner > 1e-6)
    .map((n) => ({
      zCenter: innerActiveStart + n.zCenter,
      h: n.h,
      g: n.gInner,
      cutAngle: norm2pi(n.phiInner - Math.PI),
      cutType: cfg.cutType,
    }));

  // transmissionMeshNotches returns [] when that tube's effective pattern is solid
  const outerTx = fullTube
    ? transmissionMeshNotches(cfg, 'outer', outerGeom.od / 2).map((n) => ({ ...n, zCenter: n.zCenter + outerExtension }))
    : [];
  const innerTx = fullTube
    ? transmissionMeshNotches(cfg, 'inner', innerGeom.od / 2).map((n) => ({ ...n, zCenter: n.zCenter + innerExtension }))
    : [];

  const outerBase = buildTubeMesh(outerGeom, cfg.cutType, [...outerNotches, ...outerTx], outerTotalLength);
  const innerBase = buildTubeMesh(innerGeom, cfg.cutType, [...innerNotches, ...innerTx], innerTotalLength);
  const outerExt = buildTipExtension(cfg, outerGeom, outerTotalLength);
  const innerExt = buildTipExtension(cfg, innerGeom, innerTotalLength);
  const outerMesh = outerExt ? mergeMeshes(outerBase, outerExt) : outerBase;
  const innerMesh = innerExt ? mergeMeshes(innerBase, innerExt) : innerBase;
  const tipExtension = cfg.tipFeature?.enabled ? Math.max(0, cfg.tipFeature.extension) : 0;

  return {
    outer: {
      label: `${cfg.name} · outer tube`,
      mesh: outerMesh,
      notchCount: outerNotches.length,
      transmissionCuts: outerTx.length,
      tipExtension,
      totalLength: outerTotalLength + tipExtension,
      od: outerGeom.od,
      id: outerGeom.id,
    },
    inner: {
      label: `${cfg.name} · inner tube${innerExtension > 0 ? ` (+${innerExtension} mm handle)` : ''}`,
      mesh: innerMesh,
      notchCount: innerNotches.length,
      transmissionCuts: innerTx.length,
      tipExtension,
      totalLength: innerTotalLength + tipExtension,
      od: innerGeom.od,
      id: innerGeom.id,
    },
    activeStart,
    outerActiveStart,
    innerActiveStart,
    outerExtension,
    innerExtension,
    leadIn,
    totalLength: outerTotalLength + tipExtension,
    innerTotalLength: innerTotalLength + tipExtension,
  };
}

export interface StlPart {
  label: string;
  fileName: string;
  content: Uint8Array;
  triangles: number;
  bytes: number;
}

/** One STL per tube (recommended for printing). */
export function buildStlParts(
  parts: { cfg: SegmentConfig; res: SegmentResult; fab: SegmentFab }[],
): StlPart[] {
  const out: StlPart[] = [];
  for (const { cfg, fab } of parts) {
    const slug = cfg.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
    for (const tube of [fab.outer, fab.inner]) {
      const kind = tube === fab.outer ? 'outer' : 'inner';
      const content = meshToStlBinary(tube.mesh, tube.label, tube.od / 2);
      out.push({
        label: tube.label,
        fileName: `cppr_${slug}_${kind}.stl`,
        content,
        triangles: tube.mesh.triangles.length / 3,
        bytes: content.byteLength,
      });
    }
  }
  return out;
}

/** All tubes laid out side by side on one print plate. */
export function buildAssemblyStl(
  parts: { cfg: SegmentConfig; res: SegmentResult; fab: SegmentFab }[],
  projectName: string,
  bedWidth = 200,
): { content: Uint8Array; layout: { label: string; x: number; y: number; width: number; height: number }[] } {
  const meshes: { mesh: Mesh; offsetX: number; offsetY: number; radius: number }[] = [];
  const layout: { label: string; x: number; y: number; width: number; height: number }[] = [];
  let x = 2;
  let y = 2;
  let rowH = 0;
  for (const { fab } of parts) {
    for (const tube of [fab.outer, fab.inner]) {
      const width = tube.od;
      if (x + width + 2 > bedWidth) {
        x = 2;
        y += rowH + 4;
        rowH = 0;
      }
      meshes.push({ mesh: tube.mesh, offsetX: x + width / 2, offsetY: y, radius: tube.od / 2 });
      layout.push({ label: tube.label, x, y, width, height: tube.totalLength });
      x += width + 4;
      rowH = Math.max(rowH, tube.totalLength);
    }
  }
  return {
    content: meshesToStlBinary(meshes, projectName, { printOrientation: true }),
    layout,
  };
}

export function tubeSectionSummary(cfg: SegmentConfig, res: SegmentResult) {
  const outerGeom = { od: cfg.outerTube.od, id: cfg.outerTube.od - 2 * cfg.outerTube.wall };
  const innerGeom = { od: cfg.innerTube.od, id: cfg.innerTube.od - 2 * cfg.innerTube.wall };
  const n = res.notches[res.notches.length - 1];
  if (!n) return null;
  const secO = sectionProps(outerGeom, cfg.cutType, n.gOuter);
  const secI = sectionProps(innerGeom, cfg.cutType, n.gInner);
  return { secO, secI };
}
