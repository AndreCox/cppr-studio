import type { Material } from './types';

/**
 * Representative datasheet values for materials commonly used to build CPPRs.
 * E and strain limits are nominal — always replace them with the values for the
 * exact stock you are using (the UI allows editing any field).
 *
 * Strain limits are the maximum tensile strain the design is allowed to reach.
 * For polymers this is usually the yield / linear-limit strain; for superelastic
 * nitinol the 2 % linear-elastic limit is a conservative choice for notched
 * hinges (the material can recover much larger strains, but the I/γ model is
 * linear-elastic).
 */
export const MATERIALS: Material[] = [
  {
    id: 'nitinol',
    name: 'Nitinol (superelastic)',
    E: 60000,
    nu: 0.33,
    strainLimit: 0.02,
    density: 6.45,
    color: '#8c9ba8',
    note: 'Laser-cut hypotube. 2 % linear-elastic limit (paper Table I).',
  },
  {
    id: 'stainless304',
    name: 'Stainless 304',
    E: 193000,
    nu: 0.29,
    strainLimit: 0.004,
    density: 8.0,
    color: '#a7b0b8',
    note: '0.2 % proof strain scaled for notch stress concentrations.',
  },
  {
    id: 'springsteel',
    name: 'Spring steel (1095)',
    E: 200000,
    nu: 0.29,
    strainLimit: 0.006,
    density: 7.85,
    color: '#6f7b86',
    note: 'Use a strain limit below yield with a safety factor.',
  },
  {
    id: 'aluminium6061',
    name: 'Aluminium 6061-T6',
    E: 69000,
    nu: 0.33,
    strainLimit: 0.004,
    density: 2.7,
    color: '#b8c4cc',
    note: 'Low fatigue tolerance at notches.',
  },
  {
    id: 'nylon910',
    name: 'Nylon Alloy 910 (3D print)',
    E: 1600,
    nu: 0.39,
    strainLimit: 0.10,
    density: 1.04,
    color: '#d9c9a8',
    note: 'Tough, high-strain FDM material used in the paper. Print along the axis.',
  },
  {
    id: 'nylon12',
    name: 'Nylon 12 (SLS/MJF)',
    E: 1700,
    nu: 0.4,
    strainLimit: 0.08,
    density: 1.01,
    color: '#d8d4c8',
    note: 'Isotropic powder-bed parts; good for functional prototypes.',
  },
  {
    id: 'nylon_cf',
    name: 'Nylon + carbon fibre (markforged)',
    E: 3000,
    nu: 0.35,
    strainLimit: 0.02,
    density: 1.15,
    color: '#5c5c5c',
    note: 'Stiffer, low strain — useful for larger robots.',
  },
  {
    id: 'petg',
    name: 'PETG (3D print)',
    E: 2000,
    nu: 0.38,
    strainLimit: 0.05,
    density: 1.27,
    color: '#9ec6d8',
    note: 'Layers must run along the tube axis.',
  },
  {
    id: 'pla',
    name: 'PLA (3D print)',
    E: 3500,
    nu: 0.35,
    strainLimit: 0.02,
    density: 1.24,
    color: '#c8b6d9',
    note: 'Brittle; only for desk-top demonstrations.',
  },
  {
    id: 'tpu95',
    name: 'TPU 95A (3D print)',
    E: 50,
    nu: 0.48,
    strainLimit: 0.25,
    density: 1.21,
    color: '#e7a9b8',
    note: 'Very soft; large deflections invalidate the small-strain assumptions.',
  },
  {
    id: 'peek',
    name: 'PEEK',
    E: 3600,
    nu: 0.4,
    strainLimit: 0.04,
    density: 1.3,
    color: '#c7a97a',
    note: 'Autoclavable, high-performance polymer.',
  },
  {
    id: 'custom',
    name: 'Custom material',
    E: 2000,
    nu: 0.35,
    strainLimit: 0.03,
    density: 1.2,
    color: '#7f8fa6',
    note: 'Edit E, Poisson ratio and strain limit in the inspector.',
  },
];

export const materialById = (id: string): Material =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

export function cloneMaterials(): Material[] {
  return MATERIALS.map((m) => ({ ...m }));
}

export function findMaterial(materials: Material[], id: string): Material {
  return materials.find((m) => m.id === id) ?? MATERIALS[0];
}
