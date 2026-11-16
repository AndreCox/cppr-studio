import type { SegmentConfig } from '../types';
import type { Mesh } from './tubeMesh';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Short straight collar added to both tube tips, with a diametric cross-hole.
 *
 * The hole runs along a radial direction through the entire tube, so it exits
 * on both sides (openings 180° apart). The outer and inner tube extensions use
 * the same axial position and angle, so a 1.75 mm filament pin can pass through
 * both tubes and lock the tips together.
 *
 * The collar is voxelised in (theta, rho, z) so the circular cross-hole and the
 * tube walls form a closed surface without a CSG dependency.
 */
export function buildTipExtension(
  cfg: SegmentConfig,
  tube: { od: number; id: number },
  tipZ: number,
): Mesh | null {
  const f = cfg.tipFeature;
  if (!f?.enabled) return null;

  const R = tube.od / 2;
  const a = Math.max(0.3, tube.id / 2);
  const holeD = clamp(f.holeDiameter, 1, 8);
  const r = holeD / 2;
  let ext = clamp(f.extension, 2, 40);
  const holeDist = clamp(f.holeDistance, r + 0.6, Math.max(r + 0.6, ext - r - 0.6));
  ext = Math.max(ext, holeDist + r + 0.6);
  const overlap = Math.min(2, Math.max(0.8, ext * 0.25));
  const z0 = tipZ - overlap;
  const z1 = tipZ + ext;
  const zH = z1 - holeDist;
  if (zH - r < tipZ + 0.4) return null;

  const theta0 = (f.angleDeg * Math.PI) / 180;
  const ct = Math.cos(theta0);
  const st = Math.sin(theta0);

  const Nt = 180;                 // 2° around the tube
  const wall = Math.max(0.6, R - a);
  const Nr = Math.max(4, Math.ceil(wall / 0.15));
  const Nz = Math.max(8, Math.ceil((z1 - z0) / 0.15));
  const dt = TAU / Nt;
  const dr = (R - a) / Nr;
  const dz = (z1 - z0) / Nz;

  // Material grid (theta is periodic).
  const mat: boolean[][][] = [];
  for (let i = 0; i < Nt; i++) {
    const th = (i + 0.5) * dt;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const plane: boolean[][] = [];
    for (let j = 0; j < Nr; j++) {
      const rho = a + (j + 0.5) * dr;
      const x = rho * c;
      const y = rho * s;
      const line: boolean[] = [];
      for (let k = 0; k < Nz; k++) {
        const z = z0 + (k + 0.5) * dz;
        const tangential = -x * st + y * ct;
        const removed = tangential * tangential + (z - zH) * (z - zH) < r * r;
        line.push(!removed);
      }
      plane.push(line);
    }
    mat.push(plane);
  }

  const positions: number[] = [];
  const tris: number[] = [];
  const nodeMap = new Map<string, number>();
  const node = (i: number, j: number, k: number): number => {
    const ii = ((i % Nt) + Nt) % Nt;
    const key = `${ii},${j},${k}`;
    const hit = nodeMap.get(key);
    if (hit !== undefined) return hit;
    const th = ii * dt;
    const rho = a + j * dr;
    const z = z0 + k * dz;
    positions.push(rho * Math.cos(th), rho * Math.sin(th), z);
    const idx = positions.length / 3 - 1;
    nodeMap.set(key, idx);
    return idx;
  };
  const addTri = (i0: number, i1: number, i2: number, desired: [number, number, number]) => {
    const p = positions;
    const ax = p[i1 * 3] - p[i0 * 3];
    const ay = p[i1 * 3 + 1] - p[i0 * 3 + 1];
    const az = p[i1 * 3 + 2] - p[i0 * 3 + 2];
    const bx = p[i2 * 3] - p[i0 * 3];
    const by = p[i2 * 3 + 1] - p[i0 * 3 + 1];
    const bz = p[i2 * 3 + 2] - p[i0 * 3 + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    if (nx * desired[0] + ny * desired[1] + nz * desired[2] < 0) tris.push(i0, i2, i1);
    else tris.push(i0, i1, i2);
  };
  const face = (
    p0: number, p1: number, p2: number, p3: number,
    desired: [number, number, number],
  ) => {
    addTri(p0, p1, p2, desired);
    addTri(p0, p2, p3, desired);
  };
  const isMat = (i: number, j: number, k: number): boolean => {
    if (j < 0 || j >= Nr || k < 0 || k >= Nz) return false;
    const ii = ((i % Nt) + Nt) % Nt;
    return mat[ii][j][k];
  };

  for (let i = 0; i < Nt; i++) {
    const th = (i + 0.5) * dt;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const thPlus = (i + 1) * dt;
    const thMinus = i * dt;
    for (let j = 0; j < Nr; j++) {
      for (let k = 0; k < Nz; k++) {
        if (!mat[i][j][k]) continue;
        if (!isMat(i + 1, j, k)) {
          // face at the +theta boundary
          face(node(i + 1, j, k), node(i + 1, j + 1, k), node(i + 1, j + 1, k + 1), node(i + 1, j, k + 1),
            [-Math.sin(thPlus), Math.cos(thPlus), 0]);
        }
        if (!isMat(i - 1, j, k)) {
          face(node(i, j, k), node(i, j + 1, k), node(i, j + 1, k + 1), node(i, j, k + 1),
            [Math.sin(thMinus), -Math.cos(thMinus), 0]);
        }
        if (!isMat(i, j + 1, k)) {
          face(node(i, j + 1, k), node(i + 1, j + 1, k), node(i + 1, j + 1, k + 1), node(i, j + 1, k + 1),
            [c, s, 0]);
        }
        if (!isMat(i, j - 1, k)) {
          face(node(i, j, k), node(i + 1, j, k), node(i + 1, j, k + 1), node(i, j, k + 1),
            [-c, -s, 0]);
        }
        if (!isMat(i, j, k + 1)) {
          face(node(i, j, k + 1), node(i + 1, j, k + 1), node(i + 1, j + 1, k + 1), node(i, j + 1, k + 1),
            [0, 0, 1]);
        }
        if (!isMat(i, j, k - 1)) {
          face(node(i, j, k), node(i + 1, j, k), node(i + 1, j + 1, k), node(i, j + 1, k),
            [0, 0, -1]);
        }
      }
    }
  }

  let volume = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t] * 3;
    const i1 = tris[t + 1] * 3;
    const i2 = tris[t + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  if (volume < 0) {
    for (let t = 0; t < tris.length; t += 3) {
      const tmp = tris[t + 1];
      tris[t + 1] = tris[t + 2];
      tris[t + 2] = tmp;
    }
    volume = -volume;
  }
  return { positions, triangles: tris, volume };
}

export function mergeMeshes(a: Mesh, b: Mesh): Mesh {
  const offset = a.positions.length / 3;
  return {
    positions: [...a.positions, ...b.positions],
    triangles: [...a.triangles, ...b.triangles.map((i) => i + offset)],
    volume: a.volume + b.volume,
  };
}
