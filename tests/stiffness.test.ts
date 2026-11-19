import { describe, expect, it } from 'vitest';
import { tipForceUnit, tipForceVector } from '../src/core/cosserat/stiffness';

describe('tip force directions', () => {
  it('maps azimuth and elevation to a unit world vector', () => {
    const x = tipForceUnit({ azimuthDeg: 0, elevationDeg: 0 });
    expect(x[0]).toBeCloseTo(1, 9);
    expect(x[1]).toBeCloseTo(0, 9);
    expect(x[2]).toBeCloseTo(0, 9);
    const y = tipForceUnit({ azimuthDeg: 90, elevationDeg: 0 });
    expect(y[0]).toBeCloseTo(0, 9);
    expect(y[1]).toBeCloseTo(1, 9);
    const z = tipForceUnit({ azimuthDeg: 0, elevationDeg: 90 });
    expect(z[2]).toBeCloseTo(1, 9);
  });

  it('scales the unit direction by the force magnitude', () => {
    const v = tipForceVector({ magnitude: 0.25, azimuthDeg: 90, elevationDeg: 0 });
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(0.25, 9);
    expect(v[2]).toBeCloseTo(0, 9);
  });
});
