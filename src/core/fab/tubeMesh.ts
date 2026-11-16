import type { CutType } from '../types';
import type { TubeGeometry } from '../geometry/section';

export interface MeshNotch {
  /** Axial centre of the notch, mm */
  zCenter: number;
  /** Notch axial length, mm */
  h: number;
  /** Cut parameter (chord depth or radial arc depth), mm */
  g: number;
  /** Direction of the removed material in the cross-section, rad (0 = +X) */
  cutAngle: number;
  /** Optional per-notch cut profile (defaults to the tube's cutType) */
  cutType?: CutType;
}

export interface Mesh {
  positions: number[];
  triangles: number[];
  /** Signed volume, mm^3 (positive if the winding is outward) */
  volume: number;
}

interface Vec3 { x: number; y: number; z: number }
type V2 = { x: number; y: number };

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const norm2pi = (a: number) => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};
/** smallest absolute angular difference */
const angDist = (a: number, b: number) => {
  let d = norm2pi(a - b);
  if (d > Math.PI) d = TAU - d;
  return d;
};

class Builder {
  positions: number[] = [];
  triangles: number[] = [];
  private add(p: Vec3) {
    const snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
    this.positions.push(snap(p.x), snap(p.y), snap(p.z));
    return this.positions.length / 3 - 1;
  }
  addTri(a: Vec3, b: Vec3, c: Vec3, hint?: Vec3) {
    if (hint) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const dot = nx * hint.x + ny * hint.y + nz * hint.z;
      if (dot < 0) [b, c] = [c, b];
    }
    this.triangles.push(this.add(a), this.add(b), this.add(c));
  }
  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint?: Vec3) {
    this.addTri(a, b, c, hint);
    this.addTri(a, c, d, hint);
  }
  /** Triangulate a planar 2D polygon and lift it to z. */
  addPolygon(poly: V2[], z: number, hint: Vec3) {
    const pts = poly.map((p) => ({ ...p }));
    if (pts.length < 3) return;
    if (signedArea(pts) < 0) pts.reverse();
    const idx = earClip(pts);
    for (const [i, j, k] of idx) {
      this.addTri(
        { x: pts[i].x, y: pts[i].y, z },
        { x: pts[j].x, y: pts[j].y, z },
        { x: pts[k].x, y: pts[k].y, z },
        hint,
      );
    }
  }
  finish(): Mesh {
    let volume = 0;
    const P = this.positions;
    for (let t = 0; t < this.triangles.length; t += 3) {
      const ia = this.triangles[t] * 3;
      const ib = this.triangles[t + 1] * 3;
      const ic = this.triangles[t + 2] * 3;
      const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
      const bx = P[ib], by = P[ib + 1], bz = P[ib + 2];
      const cx = P[ic], cy = P[ic + 1], cz = P[ic + 2];
      volume +=
        (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return { positions: this.positions, triangles: this.triangles, volume };
  }
}

function signedArea(pts: V2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function pointInTriangle(p: V2, a: V2, b: V2, c: V2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Ear-clipping triangulation for a simple CCW polygon. */
export function earClip(poly: V2[]): [number, number, number][] {
  const n = poly.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross <= 1e-12) continue;
      let contains = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTriangle(poly[j], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** Boundary of the material removed by a single notch, in the local cut frame. */
export function removedRegion(tube: TubeGeometry, cutType: CutType, gRaw: number, steps = 40): V2[] {
  const R = tube.od / 2;
  const a = Math.max(0, tube.id / 2);
  const g = clamp(gRaw, 0, cutType === 'chord' ? 2 * R : Math.PI * R);
  const arc = (radius: number, t0: number, t1: number, n: number): V2[] => {
    const pts: V2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      pts.push({ x: radius * Math.cos(t), y: radius * Math.sin(t) });
    }
    return pts;
  };
  if (cutType === 'radial') {
    const th = Math.min(Math.PI, g / R);
    return [
      ...arc(R, -th, th, steps),
      ...arc(a, th, -th, Math.max(8, steps >> 1)),
    ];
  }
  const c = R - g;
  if (c <= -R + 1e-9) return [];
  const thR = Math.acos(clamp(c / R, -1, 1));
  const outer = arc(R, -thR, thR, steps);
  if (c >= a) {
    // outer arc + closing chord
    return outer;
  }
  const thA = Math.acos(clamp(c / a, -1, 1));
  const inner = arc(a, thA, -thA, Math.max(8, steps >> 1));
  return [...outer, ...inner];
}

interface NotchGeom {
  z0: number;
  z1: number;
  cutAngle: number;
  thetaOuter: number;
  thetaInner: number | null;
  c: number; // effective chord coordinate for chord cuts
  g: number;
  cutType: CutType;
}

function notchGeometry(tube: TubeGeometry, cutType: CutType, n: MeshNotch): NotchGeom {
  const R = tube.od / 2;
  const a = Math.max(0, tube.id / 2);
  const g = clamp(n.g, 0, cutType === 'chord' ? 2 * R : Math.PI * R);
  const cutAngle = norm2pi(n.cutAngle);
  if (cutType === 'radial') {
    const th = Math.min(Math.PI, g / R);
    return {
      z0: n.zCenter - n.h / 2,
      z1: n.zCenter + n.h / 2,
      cutAngle,
      thetaOuter: th,
      thetaInner: th,
      c: R * Math.cos(th),
      g,
      cutType: 'radial',
    };
  }
  const c = R - g;
  const thetaOuter = Math.acos(clamp(c / R, -1, 1));
  const thetaInner = c < a ? Math.acos(clamp(c / a, -1, 1)) : null;
  return {
    z0: n.zCenter - n.h / 2,
    z1: n.zCenter + n.h / 2,
    cutAngle,
    thetaOuter,
    thetaInner,
    c,
    g,
    cutType: 'chord',
  };
}

/**
 * Solid mesh of a notched tube lying along +Z.
 * The transmission section is left solid; active notches are cut through the
 * wall exactly as the model describes them.
 */
export function buildTubeMesh(
  tube: TubeGeometry,
  cutType: CutType,
  notches: MeshNotch[],
  totalLength: number,
): Mesh {
  const R = tube.od / 2;
  const a = Math.max(0, tube.id / 2);
  const b = new Builder();
  const geoms = notches
    .map((n) => notchGeometry(tube, n.cutType ?? cutType, n))
    .filter((n) => n.z0 >= -1e-9 && n.z1 <= totalLength + 1e-9 && n.z1 > n.z0 + 1e-9);
  geoms.sort((p, q) => p.z0 - q.z0);

  // Angular stations: uniform fill + every notch edge.
  const angles: number[] = [];
  const pushAngle = (ang: number) => {
    const aa = norm2pi(ang);
    if (!angles.some((x) => Math.abs(x - aa) < 1e-7 || Math.abs(x - aa - TAU) < 1e-7)) {
      angles.push(aa);
    }
  };
  const nFill = 72;
  for (let i = 0; i < nFill; i++) pushAngle((TAU * i) / nFill);
  for (const g of geoms) {
    for (const th of [g.thetaOuter, -g.thetaOuter]) {
      pushAngle(g.cutAngle + th);
    }
    if (g.thetaInner !== null) {
      for (const th of [g.thetaInner, -g.thetaInner]) pushAngle(g.cutAngle + th);
    }
  }
  angles.sort((p, q) => p - q);
  angles.push(TAU);

  // Axial stations: only the notch boundaries and the tube ends are needed.
  // The surface is ruled, so long bands are geometrically exact.
  const zs: number[] = [0, totalLength];
  for (const g of geoms) zs.push(g.z0, g.z1);
  zs.sort((p, q) => p - q);
  const zStations: number[] = [];
  for (const z of zs) {
    if (zStations.length === 0 || z - zStations[zStations.length - 1] > 1e-6) zStations.push(z);
  }

  // Slots/notches are axial bands; precompute the active features for each
  // z band once instead of scanning every feature for every angular cell.
  const bandActive: NotchGeom[][] = [];
  for (let zi = 0; zi < zStations.length - 1; zi++) {
    const zm = 0.5 * (zStations[zi] + zStations[zi + 1]);
    bandActive.push(geoms.filter((g) => zm > g.z0 + 1e-9 && zm < g.z1 - 1e-9));
  }
  const materialAt = (theta: number, band: number, inner: boolean): boolean => {
    for (const g of bandActive[band]) {
      const th = inner ? g.thetaInner : g.thetaOuter;
      if (th !== null && angDist(theta, g.cutAngle) <= th) return false;
    }
    return true;
  };

  // Outer and inner cylindrical surfaces
  for (let zi = 0; zi < zStations.length - 1; zi++) {
    const z0 = zStations[zi];
    const z1 = zStations[zi + 1];
    if (z1 - z0 < 1e-9) continue;
    for (let ai = 0; ai < angles.length - 1; ai++) {
      const t0 = angles[ai];
      const t1 = angles[ai + 1];
      if (t1 - t0 < 1e-9) continue;
      const tm = 0.5 * (t0 + t1);
      if (materialAt(tm, zi, false)) {
        const p0 = { x: R * Math.cos(t0), y: R * Math.sin(t0), z: z0 };
        const p1 = { x: R * Math.cos(t1), y: R * Math.sin(t1), z: z0 };
        const p2 = { x: R * Math.cos(t1), y: R * Math.sin(t1), z: z1 };
        const p3 = { x: R * Math.cos(t0), y: R * Math.sin(t0), z: z1 };
        const nm = { x: Math.cos(tm), y: Math.sin(tm), z: 0 };
        b.addQuad(p0, p1, p2, p3, nm);
      }
      if (a > 1e-6 && materialAt(tm, zi, true)) {
        const p0 = { x: a * Math.cos(t0), y: a * Math.sin(t0), z: z0 };
        const p1 = { x: a * Math.cos(t1), y: a * Math.sin(t1), z: z0 };
        const p2 = { x: a * Math.cos(t1), y: a * Math.sin(t1), z: z1 };
        const p3 = { x: a * Math.cos(t0), y: a * Math.sin(t0), z: z1 };
        const nm = { x: -Math.cos(tm), y: -Math.sin(tm), z: 0 };
        b.addQuad(p0, p1, p2, p3, nm);
      }
    }
  }

  // Notch walls
  for (const g of geoms) {
    const zsInside = zStations.filter((z) => z > g.z0 + 1e-9 && z < g.z1 - 1e-9);
    const zsNear = [g.z0, ...zsInside, g.z1];
    const ca = Math.cos(g.cutAngle);
    const sa = Math.sin(g.cutAngle);
    const to3 = (x: number, y: number, z: number): Vec3 => ({
      x: x * ca - y * sa,
      y: x * sa + y * ca,
      z,
    });

    if (g.cutType === 'radial') {
      for (const side of [-1, 1]) {
        const th = side * g.thetaOuter;
        const dir = { x: -Math.sin(th), y: Math.cos(th) };
        const hint = to3(side * dir.x, side * dir.y, 0);
        for (let i = 0; i < zsNear.length - 1; i++) {
          const z0 = zsNear[i];
          const z1 = zsNear[i + 1];
          const o0 = { x: R * Math.cos(th), y: R * Math.sin(th) };
          const i0 = { x: a * Math.cos(th), y: a * Math.sin(th) };
          b.addQuad(
            to3(i0.x, i0.y, z0),
            to3(o0.x, o0.y, z0),
            to3(o0.x, o0.y, z1),
            to3(i0.x, i0.y, z1),
            hint,
          );
        }
      }
    } else {
      const c = g.c;
      const yR = Math.sqrt(Math.max(0, R * R - c * c));
      const yA = g.thetaInner !== null ? Math.sqrt(Math.max(0, a * a - c * c)) : 0;
      const faces: [number, number][] = g.thetaInner !== null
        ? [[yA, yR], [-yR, -yA]]
        : [[-yR, yR]];
      const hint = to3(1, 0, 0);
      for (const [y0, y1] of faces) {
        for (let i = 0; i < zsNear.length - 1; i++) {
          const za = zsNear[i];
          const zb = zsNear[i + 1];
          b.addQuad(
            to3(c, y0, za),
            to3(c, y1, za),
            to3(c, y1, zb),
            to3(c, y0, zb),
            hint,
          );
        }
      }
    }

    // Notch end faces. Build the removed-region polygon from the *global*
    // angular stations so its boundary edges match the cylinder surfaces.
    const capPoly = (): V2[] => {
      const local = (ang: number) => {
        let d = norm2pi(ang - g.cutAngle);
        if (d > Math.PI) d -= TAU;
        return d;
      };
      const stationsFor = (theta: number): number[] => {
        const arr = angles
          .filter((ang) => Math.abs(local(ang)) < theta - 1e-9)
          .map((ang) => local(ang))
          .sort((p, q) => p - q);
        const out = [-theta, ...arr, theta];
        const uniq: number[] = [];
        for (const v of out) {
          if (uniq.length === 0 || v - uniq[uniq.length - 1] > 1e-7) uniq.push(v);
        }
        return uniq;
      };
      const outerLocal = stationsFor(g.thetaOuter);
      const outerPts = outerLocal.map((t) => ({
        x: R * Math.cos(g.cutAngle + t),
        y: R * Math.sin(g.cutAngle + t),
      }));
      if (cutType === 'radial') {
        const innerPts = stationsFor(g.thetaOuter)
          .reverse()
          .map((t) => ({ x: a * Math.cos(g.cutAngle + t), y: a * Math.sin(g.cutAngle + t) }));
        return [...outerPts, ...innerPts];
      }
      if (g.thetaInner === null) return outerPts;
      const innerPts = stationsFor(g.thetaInner)
        .reverse()
        .map((t) => ({ x: a * Math.cos(g.cutAngle + t), y: a * Math.sin(g.cutAngle + t) }));
      return [...outerPts, ...innerPts];
    };
    const poly = capPoly();
    if (poly.length >= 3) {
      b.addPolygon(poly, g.z0, { x: 0, y: 0, z: 1 });
      b.addPolygon(poly, g.z1, { x: 0, y: 0, z: -1 });
    }
  }

  // Tube end annuli
  for (const [z, sign] of [[0, -1], [totalLength, 1]] as [number, number][]) {
    for (let ai = 0; ai < angles.length - 1; ai++) {
      const t0 = angles[ai];
      const t1 = angles[ai + 1];
      if (t1 - t0 < 1e-9) continue;
      const hint = { x: 0, y: 0, z: sign };
      if (a > 1e-6) {
        b.addQuad(
          { x: R * Math.cos(t0), y: R * Math.sin(t0), z },
          { x: R * Math.cos(t1), y: R * Math.sin(t1), z },
          { x: a * Math.cos(t1), y: a * Math.sin(t1), z },
          { x: a * Math.cos(t0), y: a * Math.sin(t0), z },
          hint,
        );
      } else {
        b.addTri(
          { x: 0, y: 0, z },
          { x: R * Math.cos(t0), y: R * Math.sin(t0), z },
          { x: R * Math.cos(t1), y: R * Math.sin(t1), z },
          hint,
        );
      }
    }
  }

  return b.finish();
}

export interface StlEntry {
  mesh: Mesh;
  offsetX?: number;
  offsetY?: number;
  /** outer radius, used to lay the tube flat on a print bed */
  radius?: number;
}

/**
 * ASCII STL writer.
 * With printOrientation the tube axis (model +Z) is laid along +Y on the print
 * bed, so the slicer's layers run along the tube axis (recommended for CPPRs).
 */
export function meshesToStl(
  entries: StlEntry[],
  name = 'cppr',
  opts: { printOrientation?: boolean } = {},
): string {
  const lines: string[] = [`solid ${name.replace(/\s+/g, '_')}`];
  const f = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(4));
  const print = !!opts.printOrientation;
  for (const { mesh, offsetX = 0, offsetY = 0, radius = 0 } of entries) {
    const P = mesh.positions;
    const V = (i: number): [number, number, number] => {
      const x = P[i];
      const y = P[i + 1];
      const z = P[i + 2];
      return print ? [x + offsetX, z + offsetY, radius - y] : [x + offsetX, y + offsetY, z];
    };
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      const a = V(mesh.triangles[t] * 3);
      const b = V(mesh.triangles[t + 1] * 3);
      const c = V(mesh.triangles[t + 2] * 3);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      lines.push(`  facet normal ${f(nx)} ${f(ny)} ${f(nz)}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${f(a[0])} ${f(a[1])} ${f(a[2])}`);
      lines.push(`      vertex ${f(b[0])} ${f(b[1])} ${f(b[2])}`);
      lines.push(`      vertex ${f(c[0])} ${f(c[1])} ${f(c[2])}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }
  lines.push(`endsolid ${name.replace(/\s+/g, '_')}`);
  return lines.join('\n');
}

/** Single tube in the recommended print orientation. */
export function meshToStl(mesh: Mesh, name: string, radius: number): string {
  return meshesToStl([{ mesh, radius }], name, { printOrientation: true });
}


/** Binary STL (compact, accepted by every slicer). */
export function meshesToStlBinary(
  entries: StlEntry[],
  name = 'cppr',
  opts: { printOrientation?: boolean } = {},
): Uint8Array {
  const print = !!opts.printOrientation;
  const triCount = entries.reduce((a, e) => a + e.mesh.triangles.length / 3, 0);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = new TextEncoder().encode(`CPPR Studio · ${name}`).slice(0, 79);
  new Uint8Array(buf, 0, header.length).set(header);
  view.setUint32(80, triCount, true);
  let off = 84;
  for (const { mesh, offsetX = 0, offsetY = 0, radius = 0 } of entries) {
    const P = mesh.positions;
    const V = (i: number): [number, number, number] => {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      return print ? [x + offsetX, z + offsetY, radius - y] : [x + offsetX, y + offsetY, z];
    };
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      const a = V(mesh.triangles[t] * 3);
      const b = V(mesh.triangles[t + 1] * 3);
      const c = V(mesh.triangles[t + 2] * 3);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      view.setFloat32(off, nx, true); view.setFloat32(off + 4, ny, true); view.setFloat32(off + 8, nz, true);
      view.setFloat32(off + 12, a[0], true); view.setFloat32(off + 16, a[1], true); view.setFloat32(off + 20, a[2], true);
      view.setFloat32(off + 24, b[0], true); view.setFloat32(off + 28, b[1], true); view.setFloat32(off + 32, b[2], true);
      view.setFloat32(off + 36, c[0], true); view.setFloat32(off + 40, c[1], true); view.setFloat32(off + 44, c[2], true);
      view.setUint16(off + 48, 0, true);
      off += 50;
    }
  }
  return new Uint8Array(buf);
}

export function meshToStlBinary(mesh: Mesh, name: string, radius: number): Uint8Array {
  return meshesToStlBinary([{ mesh, radius }], name, { printOrientation: true });
}
