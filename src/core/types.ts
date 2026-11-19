/**
 * Core data model for CPPR Studio.
 *
 * Conventions (all lengths in millimetres unless a field says otherwise):
 *  - The robot axis at rest is +Z.
 *  - Bending happens in the local X–Z plane. Positive curvature bends the
 *    centreline toward +X (the inner tube backbone side).
 *  - Curvature kappa [1/mm], actuation q [mm] (positive = pulling the inner tube).
 *  - Elastic modulus E [MPa = N/mm^2], strain [-] (not %).
 */

export type CutType = 'chord' | 'radial';

export interface Material {
  id: string;
  name: string;
  /** Young's modulus, MPa */
  E: number;
  /** Poisson's ratio (used for torsional stiffness estimates) */
  nu: number;
  /** Maximum usable tensile strain, fraction (0.02 = 2 %) */
  strainLimit: number;
  /** Density, g/cm^3 */
  density: number;
  color: string;
  /** Short source/note shown in the material picker */
  note?: string;
}

export interface TubeSpec {
  /** Outer diameter, mm */
  od: number;
  /** Wall thickness, mm */
  wall: number;
  materialId: string;
}

export interface TipFeatureConfig {
  /** Add a short solid-wall tube extension and cross-pin hole at the distal tips */
  enabled: boolean;
  /** Axial extension added to both tubes beyond the active tip, mm */
  extension: number;
  /** Cross-hole diameter, mm (1.75 mm filament needs ~2.0 mm) */
  holeDiameter: number;
  /** Hole centre distance from the final tip, mm */
  holeDistance: number;
  /** Clocking angle of the hole around the tube, deg */
  angleDeg: number;
}

export type TransmissionPattern = 'solid' | 'brickwork' | 'discrete';

export interface TransmissionCoupler {
  /** Add a separate sleeve joining the solid extension to the transmission. */
  enabled: boolean;
  /** Which tube(s) receive the coupler. */
  tubes: 'outer' | 'inner' | 'both';
  /** Overall sleeve length along the tube, mm. */
  length: number;
  /** Sleeve wall thickness, mm. */
  wall: number;
  /** Radial clearance over the tube OD, mm. */
  clearance: number;
}

export interface TransmissionConfig {
  /** Length of un-notched transmission tube behind the active section, mm */
  length: number;
  /** Solid proximal extension + coupler joining it to the transmission. */
  coupler: TransmissionCoupler;
  /** Pattern on the outer tube's transmission */
  pattern: TransmissionPattern;
  /** Pattern on the inner tube's transmission ('same' follows the outer pattern) */
  innerPattern: TransmissionPattern | 'same';
  /** Cuts per revolution */
  cutsPerRev: number;
  /** Kerf, mm */
  kerf: number;
  /** Axial pitch between cuts within a bending segment, mm */
  pitch: number;
  /** Separation angle for the discrete pattern (deg) */
  separationDeg: number;
  /** Overlap angle (deg) */
  overlapDeg: number;
  /** Number of levels per discrete bending segment */
  levels: number;
  /** Axial gap between discrete bending segments, mm (0 = auto from curvature limit) */
  gap: number;
  /** Riffle angle between successive discrete segments (deg) */
  riffleDeg: number;
  /** Largest curvature the transmission must accommodate, 1/mm */
  maxCurvature: number;
}

export type ShapePreset =
  | 'constant'
  | 'sCurve'
  | 'tipFirst'
  | 'baseFirst'
  | 'retroflex'
  | 'midBend'
  | 'straight';

export interface ShapeSpec {
  kind: 'preset' | 'waypoints';
  preset: ShapePreset;
  /** Peak centreline curvature magnitude used to scale the normalised profile, 1/mm */
  kappaMax: number;
  /** Catmull-Rom control points for custom shapes, normalised by active length (x,z) */
  waypoints: { x: number; z: number }[];
}

export interface SegmentConfig {
  id: string;
  name: string;
  enabled: boolean;
  /** Rotation of this segment's bending plane about its base tangent, deg */
  rollDeg: number;
  /** Active (notched) centreline length L, mm */
  activeLength: number;
  /** Number of notches n */
  notches: number;
  /** Fraction of the centreline occupied by straight, rigid sections */
  beta: number;
  outerTube: TubeSpec;
  innerTube: TubeSpec;
  /** Extra solid length at the proximal end of the inner tube for hand actuation, mm */
  innerExtension: number;
  /** Extra solid length at the proximal end of the outer tube, joined to the transmission. */
  outerExtension: number;
  /** Optional tip collar with a diametric cross-pin hole at both distal tips */
  tipFeature: TipFeatureConfig;
  cutType: CutType;
  shape: ShapeSpec;
  /** direct = curvature sampled from desired curve; sequential = paper's normal-error fit */
  fitMode: 'direct' | 'sequential';
  /** Material strain limit override, fraction. null = material value */
  strainLimitOverride: number | null;
  safetyFactor: number;
  /** Minimum remaining backbone width after the deepest cut, mm */
  minBackbone: number;
  /** Hard cap on notch depth as a fraction of OD */
  maxDepthFrac: number;
  /** Remove the first notch from the model for negative actuation */
  firstNotchLockout: boolean;
  /** Minimum radial clearance between the two tubes, mm (used for validation) */
  minClearance: number;
  transmission: TransmissionConfig;
  notes: string;
}

export interface ProjectSettings {
  /** Show a faint fan of actuation states in the 2D view */
  showActuationFan: boolean;
  /** Colour the actuated shape by strain */
  colourByStrain: boolean;
  /** Show fabrication warnings */
  strictFabrication: boolean;
  /** Print bed size for assembly layout, mm */
  bedWidth: number;
  bedHeight: number;
}

export interface Project {
  version: 1;
  name: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  segments: SegmentConfig[];
  /** Editable material library for this project */
  materials: Material[];
  settings: ProjectSettings;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface NotchResult {
  index: number;
  /** Notch centre position along the unactuated outer tube, mm (from the proximal end of the active section) */
  zCenter: number;
  /** Notch axial length h, mm */
  h: number;
  /** Curved centreline length over the notch, mm */
  l: number;
  /** Rigid length after the notch, mm */
  c: number;
  gOuter: number;
  gInner: number;
  gammaOuter: number;
  gammaInner: number;
  IOuter: number;
  IInner: number;
  EIOuter: number;
  EIInner: number;
  /** Signed notch orientation: outer neutral axis offset angle, rad (0 or PI) */
  phiOuter: number;
  phiInner: number;
  /** Desired / achieved centreline curvature, 1/mm (signed) */
  kappaTarget: number;
  kappaDesign: number;
  kappaOuter: number;
  kappaInner: number;
  d: number;
  /** Compliance constant d/(EI_o+EI_i), 1/(N mm) */
  alpha: number;
  /** Strain magnitudes at the four edges of the notch pair */
  strainOuterBackbone: number;
  strainOuterCut: number;
  strainInnerBackbone: number;
  strainInnerCut: number;
  strainMax: number;
  /** Utilisation of the allowable strain */
  strainUtilisation: number;
  /** Euler buckling margin: h / h_crit (<1 is safe) */
  bucklingRatio: number;
  /** 1/mm limit from notch self-interference */
  closureLimit: number;
  /** Design targets / flags */
  depthCapped: boolean;
  EIUnmatched: boolean;
  warnings: string[];
}

export interface Pose2D {
  x: number;
  z: number;
  /** tangent angle from +Z toward +X, rad */
  psi: number;
}

export interface ShapeSample extends Pose2D {
  s: number;
}

export interface ActuationState {
  /** Relative tube base displacement, mm (positive = pull inner tube) */
  q: number;
  /** Inner-tube tension, N */
  tau: number;
  /** Centreline curvatures actually produced, 1/mm (signed) */
  kappas: number[];
  /** Outer-tube neutral-axis curvatures (model unknowns), 1/mm */
  kappasOuter: number[];
  /** Model shape samples (dense) */
  shape: ShapeSample[];
  /** Arc-length span of each bending notch in this state */
  notchArcs: { index: number; sStart: number; sEnd: number; kappa: number }[];
  tip: Pose2D;
  /** Max strain over all notch pairs at this state */
  maxStrain: number;
  converged: boolean;
  note?: string;
}

export interface SegmentResult {
  segmentId: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
  /** Desired centreline, arc-length sampled, mm in the segment's local frame */
  desiredShape: ShapeSample[];
  desiredKappa: { s: number; kappa: number }[];
  notches: NotchResult[];
  /** Shape at the design actuation */
  designState: ActuationState | null;
  /** Actuation sweep for previews */
  sweep: ActuationState[];
  qDesign: number;
  tauDesign: number;
  /** RMS shape error at the design state, normalised by active length */
  rmsError: number;
  tipError: number;
  /** Physical (unactuated) tube length including straight sections; not incl. transmission */
  activeTubeLength: number;
  /** Max achievable centreline curvature for this geometry/limits, 1/mm */
  kappaCapacity: number | null;
  /** Mass of the two active tube pairs, g */
  mass: number;
  clearance: number;
  innerId: number;
  outerId: number;
  notchTable: NotchResult[];
}

export interface RobotResult {
  ok: boolean;
  segments: SegmentResult[];
  errors: string[];
  warnings: string[];
  info: string[];
  /** World-space 3D centreline polyline of the actuated robot */
  worldShape: [number, number, number][];
  /** Per-segment 3D polylines + tip frames for rendering */
  worldSegments: {
    segmentId: string;
    points: [number, number, number][];
    tip: [number, number, number];
    frames: { position: [number, number, number]; quaternion: [number, number, number, number] }[];
    notches: { position: [number, number, number]; quaternion: [number, number, number, number]; h: number }[];
  }[];
  totalLength: number;
  dof: number;
}
