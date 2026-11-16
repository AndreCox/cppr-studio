import type {
  Project,
  ProjectSettings,
  SegmentConfig,
  ShapeSpec,
  TipFeatureConfig,
  TransmissionConfig,
  TubeSpec,
} from './types';
import { cloneMaterials } from './materials';

let idCounter = 0;
export const newId = (prefix = 'seg') => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const defaultSettings = (): ProjectSettings => ({
  showActuationFan: true,
  colourByStrain: true,
  strictFabrication: true,
  bedWidth: 200,
  bedHeight: 200,
});

export const defaultTransmission = (): TransmissionConfig => ({
  length: 900,
  pattern: 'discrete',
  innerPattern: 'same',
  cutsPerRev: 6,
  kerf: 0.08,
  pitch: 0.35,
  separationDeg: 15,
  overlapDeg: 15,
  levels: 6,
  gap: 0,
  riffleDeg: 68.75,
  maxCurvature: 0.02,
});

export const defaultTipFeature = (): TipFeatureConfig => ({
  enabled: false,
  extension: 6,
  holeDiameter: 2.0,
  holeDistance: 2.0,
  angleDeg: 90,
});

export const defaultShape = (preset: ShapeSpec['preset'] = 'sCurve', kappaMax = 0.08): ShapeSpec => ({
  kind: 'preset',
  preset,
  kappaMax,
  waypoints: [],
});

export function makeSegment(overrides: Partial<SegmentConfig> = {}): SegmentConfig {
  const base: SegmentConfig = {
    id: newId(),
    name: 'Segment',
    enabled: true,
    rollDeg: 0,
    activeLength: 52.5,
    notches: 10,
    beta: 0.623,
    outerTube: { od: 4.02, wall: 0.16, materialId: 'nitinol' },
    innerTube: { od: 3.5, wall: 0.15, materialId: 'nitinol' },
    innerExtension: 0,
    tipFeature: defaultTipFeature(),
    cutType: 'chord',
    shape: defaultShape('sCurve', 0.042),
    fitMode: 'sequential',
    strainLimitOverride: null,
    safetyFactor: 1,
    minBackbone: 0.15,
    maxDepthFrac: 0.95,
    firstNotchLockout: true,
    minClearance: 0.05,
    transmission: defaultTransmission(),
    notes: '',
  };
  return { ...base, ...overrides };
}

export const PAPER_NITINOL = (): SegmentConfig =>
  makeSegment({
    name: 'Nitinol S-curve (paper)',
    activeLength: 52.5,
    notches: 10,
    beta: 0.623,
    outerTube: { od: 4.02, wall: 0.16, materialId: 'nitinol' },
    innerTube: { od: 3.5, wall: 0.15, materialId: 'nitinol' },
    shape: defaultShape('sCurve', 0.042),
    strainLimitOverride: 0.02,
    safetyFactor: 1,
    minBackbone: 0.15,
    maxDepthFrac: 0.95,
    transmission: { ...defaultTransmission(), length: 900, pattern: 'solid' },
    notes:
      'Geometry from Oliver-Butler et al., IEEE T-RO 2022, Table I. The published prototype uses laser-cut radial notches; this preset uses the equivalent chord cut for a like-for-like dataset.',
  });

export const PRINTED_DEMO = (): Project => {
  const seg1 = makeSegment({
    name: 'Proximal',
    activeLength: 85,
    notches: 12,
    beta: 0.55,
    outerTube: { od: 16, wall: 1.3, materialId: 'nylon910' },
    innerTube: { od: 13, wall: 1.2, materialId: 'nylon910' },
    innerExtension: 40,
    cutType: 'chord',
    shape: defaultShape('baseFirst', 0.019),
    safetyFactor: 2,
    minBackbone: 1.1,
    maxDepthFrac: 0.92,
    transmission: {
      ...defaultTransmission(),
      length: 60,
      pattern: 'solid',
      innerPattern: 'same',
      cutsPerRev: 4,
      kerf: 0.6,
      pitch: 1.2,
      levels: 3,
      separationDeg: 30,
      overlapDeg: 20,
      gap: 0,
    },
    notes: '3D-print this pair horizontally with the layers running along the tube axis. The full-tube STL includes the printable transmission flexure.',
  });
  const seg2 = makeSegment({
    name: 'Distal',
    rollDeg: 90,
    activeLength: 70,
    notches: 10,
    beta: 0.55,
    outerTube: { od: 10, wall: 1.1, materialId: 'nylon910' },
    innerTube: { od: 7.5, wall: 0.9, materialId: 'nylon910' },
    innerExtension: 70,
    tipFeature: { ...defaultTipFeature(), enabled: true },
    cutType: 'chord',
    shape: defaultShape('tipFirst', 0.019),
    safetyFactor: 2,
    minBackbone: 0.8,
    maxDepthFrac: 0.92,
    transmission: {
      ...defaultTransmission(),
      length: 90,
      pattern: 'discrete',
      innerPattern: 'same',
      cutsPerRev: 4,
      kerf: 0.6,
      pitch: 1.2,
      levels: 3,
      separationDeg: 30,
      overlapDeg: 20,
      gap: 0,
    },
  });
  return {
    version: 1,
    name: 'Two-segment 3D-printed demo',
    author: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    materials: cloneMaterials(),
    segments: [seg1, seg2],
    settings: defaultSettings(),
  };
};

export const SINGLE_ARC = (): Project => ({
  version: 1,
  name: 'Nitinol S-curve (paper validation)',
  author: 'CPPR Studio',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  materials: cloneMaterials(),
  segments: [PAPER_NITINOL()],
  settings: defaultSettings(),
});

export const LASER_DEMO = (): Project => {
  const seg = makeSegment({
    name: 'Laser-cut nitinol',
    activeLength: 40,
    notches: 8,
    beta: 0.5,
    outerTube: { od: 4.02, wall: 0.16, materialId: 'nitinol' },
    innerTube: { od: 3.5, wall: 0.15, materialId: 'nitinol' },
    cutType: 'radial',
    shape: defaultShape('constant', 0.05),
    safetyFactor: 1,
    minBackbone: 0.2,
    maxDepthFrac: 0.95,
    transmission: { ...defaultTransmission(), length: 900, pattern: 'solid' },
  });
  return {
    version: 1,
    name: 'Laser-cut nitinol arc',
    author: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    materials: cloneMaterials(),
    segments: [seg],
    settings: defaultSettings(),
  };
};

export const EXAMPLES: { id: string; name: string; description: string; make: () => Project }[] = [
  {
    id: 'nitinol',
    name: 'Nitinol S-curve (paper)',
    description: '4 mm laser-cut nitinol prototype geometry from the paper, modelled with chord cuts.',
    make: SINGLE_ARC,
  },
  {
    id: 'printed',
    name: 'Two-segment printed robot',
    description: 'A two-pair CPPR with orthogonal bending planes, sized for a 200 mm print bed.',
    make: PRINTED_DEMO,
  },
  {
    id: 'laser',
    name: 'Laser-cut arc',
    description: 'A radial-notch nitinol pair with a constant-curvature target.',
    make: LASER_DEMO,
  },
];

export function newProject(): Project {
  return {
    version: 1,
    name: 'Untitled CPPR',
    author: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    materials: cloneMaterials(),
    segments: [makeSegment({ name: 'Segment 1' })],
    settings: defaultSettings(),
  };
}

export function cloneSegment(s: SegmentConfig, name?: string): SegmentConfig {
  return {
    ...s,
    id: newId(),
    name: name ?? `${s.name} copy`,
    outerTube: { ...s.outerTube } as TubeSpec,
    innerTube: { ...s.innerTube } as TubeSpec,
    shape: { ...s.shape, waypoints: s.shape.waypoints.map((p) => ({ ...p })) },
    transmission: { ...s.transmission },
  };
}
