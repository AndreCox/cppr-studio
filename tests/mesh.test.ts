import { describe, expect, it } from 'vitest';
import { buildTubeMesh, meshesToStl, removedRegion } from '../src/core/fab/tubeMesh';
import { sectionProps } from '../src/core/geometry/section';

describe('tube mesh', () => {
  const tube = { od: 4.02, id: 3.7 };
  const L = 30;
  const notches = [
    { zCenter: 8, h: 2.2, g: 3.63, cutAngle: 0 },
    { zCenter: 13.5, h: 2.2, g: 3.55, cutAngle: Math.PI },
    { zCenter: 19, h: 2.2, g: 3.32, cutAngle: 0 },
  ];

  it('has positive, consistent volume close to the analytic value', () => {
    const mesh = buildTubeMesh(tube, 'chord', notches, L);
    const solid = Math.PI * ((tube.od / 2) ** 2 - (tube.id / 2) ** 2);
    let removed = 0;
    for (const n of notches) {
      const sec = sectionProps(tube, 'chord', n.g);
      removed += (solid - sec.area) * n.h;
    }
    const expected = solid * L - removed;
    expect(mesh.volume).toBeGreaterThan(0);
    expect(mesh.volume / expected).toBeGreaterThan(0.995);
    expect(mesh.volume / expected).toBeLessThan(1.005);
  });

  it('produces a watertight triangulation (every edge has a partner)', () => {
    const mesh = buildTubeMesh(tube, 'chord', notches, L);
    const edges = new Map<string, number>();
    const key = (i: number) => {
      const p = mesh.positions;
      return `${(p[i*3]).toFixed(4)},${(p[i*3+1]).toFixed(4)},${(p[i*3+2]).toFixed(4)}`;
    };
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      const k = [0, 1, 2].map((j) => key(mesh.triangles[t + j]));
      for (let e = 0; e < 3; e++) {
        const a = k[e];
        const b = k[(e + 1) % 3];
        const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(ek, (edges.get(ek) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const count of edges.values()) if (count !== 2) open++;
    console.log('open edges', open, 'of', edges.size, 'tris', mesh.triangles.length / 3);
    expect(open).toBe(0);
  });

  it('works for radial cuts too', () => {
    const mesh = buildTubeMesh(tube, 'radial', [
      { zCenter: 8, h: 2.2, g: 3.7, cutAngle: 0 },
    ], L);
    const solid = Math.PI * ((tube.od / 2) ** 2 - (tube.id / 2) ** 2);
    const sec = sectionProps(tube, 'radial', 3.7);
    const expected = solid * L - (solid - sec.area) * 2.2;
    expect(mesh.volume / expected).toBeGreaterThan(0.99);
    expect(mesh.volume / expected).toBeLessThan(1.01);
  });

  it('removed region for a deep chord cut matches the section area', () => {
    const poly = removedRegion(tube, 'chord', 3.63, 120);
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      area += p.x * q.y - q.x * p.y;
    }
    area = Math.abs(area / 2);
    const sec = sectionProps(tube, 'chord', 3.63);
    const solid = Math.PI * ((tube.od / 2) ** 2 - (tube.id / 2) ** 2);
    expect((solid - sec.area) / area).toBeGreaterThan(0.98);
    expect((solid - sec.area) / area).toBeLessThan(1.02);
  });

  it('writes STL', () => {
    const mesh = buildTubeMesh(tube, 'chord', notches, L);
    const stl = meshesToStl([{ mesh, offsetX: 0, offsetY: 0 }]);
    expect(stl.startsWith('solid')).toBe(true);
    expect(stl).toContain('facet normal');
    expect(stl.trim().endsWith('endsolid cppr')).toBe(true);
  });
});

describe('print orientation', () => {
  it('lays the tube flat along +Y with the bed at z=0', async () => {
    const { meshToStl } = await import('../src/core/fab/tubeMesh');
    const tube = { od: 4.02, id: 3.7 };
    const mesh = buildTubeMesh(tube, 'chord', [{ zCenter: 8, h: 2.2, g: 3.63, cutAngle: 0 }], 20);
    const stl = meshToStl(mesh, 'test', tube.od / 2);
    const verts = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const ys = verts.map((v) => v[1]);
    const zs = verts.map((v) => v[2]);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(20, 1);
    expect(Math.min(...zs)).toBeCloseTo(0, 2);
    expect(Math.max(...zs)).toBeCloseTo(4.02, 1);
  });
});

describe('binary STL', () => {
  it('round-trips the triangle count and volume in print orientation', async () => {
    const { meshToStlBinary } = await import('../src/core/fab/tubeMesh');
    const mesh = buildTubeMesh({ od: 8, id: 7 }, 'chord', [{ zCenter: 10, h: 2, g: 6.5, cutAngle: 0 }], 20);
    const bin = meshToStlBinary(mesh, 'test', 4);
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const count = view.getUint32(80, true);
    expect(count).toBe(mesh.triangles.length / 3);
    let vol = 0;
    for (let i = 0; i < count; i++) {
      const o = 84 + i * 50 + 12;
      const a = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
      const b = [view.getFloat32(o + 12, true), view.getFloat32(o + 16, true), view.getFloat32(o + 20, true)];
      const c = [view.getFloat32(o + 24, true), view.getFloat32(o + 28, true), view.getFloat32(o + 32, true)];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    expect(vol).toBeCloseTo(mesh.volume, 0);
    expect(vol).toBeGreaterThan(0);
  });
});
