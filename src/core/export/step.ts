/**
 * Analytic STEP export for the printable tubes.
 *
 * SolidWorks assemblies need smooth B-rep faces, not a triangle soup. This
 * writer emits a clean hollow-cylinder solid per tube: outer/inner cylindrical
 * surfaces and planar annular end faces, with millimetre units. Notches,
 * transmission slots and tip cross-pin holes are intentionally omitted from
 * the CAD assembly model; the STL remains the detailed fabrication geometry.
 */

export interface StepTube {
  name: string;
  od: number;
  id: number;
  /** Overall tube length, mm. */
  length: number;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const stepString = (s: string) => `'${clean(s).replace(/'/g, "''")}'`;

function stepReal(v: number): string {
  if (!Number.isFinite(v)) return '0.';
  if (Math.abs(v) < 1e-12) return '0.';
  let s = v.toPrecision(9);
  if (s.includes('e')) s = s.replace('e', 'E');
  if (!s.includes('.') && !s.includes('E')) s += '.';
  return s;
}

const vec = (p: [number, number, number]) => `(${stepReal(p[0])},${stepReal(p[1])},${stepReal(p[2])})`;

/** Write one or more hollow tubes as AP214 manifold solids. */
export function tubesToStep(parts: StepTube[], fileName: string, productName = fileName): string {
  const entities: string[] = [];
  let next = 1;
  const id = () => next++;

  const lengthUnit = id();
  entities.push(`#${lengthUnit} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );`);
  const angleUnit = id();
  entities.push(`#${angleUnit} = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );`);
  const solidAngleUnit = id();
  entities.push(`#${solidAngleUnit} = ( NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.) );`);
  const uncertainty = id();
  entities.push(`#${uncertainty} = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-6),#${lengthUnit},'distance_accuracy_value','confusion accuracy');`);
  const context = id();
  entities.push(`#${context} = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidAngleUnit})) REPRESENTATION_CONTEXT('Context','3D') );`);

  const app = id();
  entities.push(`#${app} = APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies');`);
  const protocol = id();
  entities.push(`#${protocol} = APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app});`);
  const productContext = id();
  entities.push(`#${productContext} = PRODUCT_CONTEXT('',#${app},'mechanical');`);
  const product = id();
  entities.push(`#${product} = PRODUCT(${stepString(productName)},${stepString(productName)},'',(#${productContext}));`);
  const formation = id();
  entities.push(`#${formation} = PRODUCT_DEFINITION_FORMATION('','',#${product});`);
  const pdContext = id();
  entities.push(`#${pdContext} = PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design');`);
  const productDefinition = id();
  entities.push(`#${productDefinition} = PRODUCT_DEFINITION('design','',#${formation},#${pdContext});`);
  const productShape = id();
  entities.push(`#${productShape} = PRODUCT_DEFINITION_SHAPE('','',#${productDefinition});`);

  const solids: number[] = [];

  for (const part of parts) {
    const Ro = Math.max(0.05, part.od / 2);
    const Ri = Math.max(0, Math.min(part.id / 2, Ro - 0.02));
    const L = Math.max(0.1, part.length);
    const name = part.name;

    // Geometric helpers.
    const point = (p: [number, number, number]) => {
      const entity = id();
      entities.push(`#${entity} = CARTESIAN_POINT('',${vec(p)});`);
      return entity;
    };
    const direction = (d: [number, number, number]) => {
      const entity = id();
      entities.push(`#${entity} = DIRECTION('',${vec(d)});`);
      return entity;
    };
    const axis = (origin: [number, number, number], normal: [number, number, number], ref: [number, number, number]) => {
      const entity = id();
      entities.push(`#${entity} = AXIS2_PLACEMENT_3D('',#${point(origin)},#${direction(normal)},#${direction(ref)});`);
      return entity;
    };
    const vertex = (p: [number, number, number]) => {
      const entity = id();
      entities.push(`#${entity} = VERTEX_POINT('',#${point(p)});`);
      return entity;
    };
    const circle = (at: [number, number, number], radius: number) => {
      const entity = id();
      entities.push(`#${entity} = CIRCLE('',#${axis(at, [0, 0, 1], [1, 0, 0])},${stepReal(radius)});`);
      return entity;
    };
    const cylinder = (radius: number) => {
      const entity = id();
      entities.push(`#${entity} = CYLINDRICAL_SURFACE('',#${axis([0, 0, 0], [0, 0, 1], [1, 0, 0])},${stepReal(radius)});`);
      return entity;
    };
    const plane = (at: [number, number, number], normal: [number, number, number]) => {
      const entity = id();
      entities.push(`#${entity} = PLANE('',#${axis(at, normal, [1, 0, 0])});`);
      return entity;
    };
    const lineEdge = (a: [number, number, number], b: [number, number, number], va: number, vb: number) => {
      const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const dir = direction([d[0] / len, d[1] / len, d[2] / len]);
      const v = id();
      entities.push(`#${v} = VECTOR('',#${dir},1.);`);
      const ln = id();
      entities.push(`#${ln} = LINE('',#${point(a)},#${v});`);
      const edge = id();
      entities.push(`#${edge} = EDGE_CURVE('',#${va},#${vb},#${ln},.T.);`);
      return edge;
    };
    const circleEdge = (circleId: number, v: number) => {
      const edge = id();
      entities.push(`#${edge} = EDGE_CURVE('',#${v},#${v},#${circleId},.T.);`);
      return edge;
    };
    const oriented = (edge: number, same: boolean) => {
      const entity = id();
      entities.push(`#${entity} = ORIENTED_EDGE('',*,*,#${edge},${same ? '.T.' : '.F.'});`);
      return entity;
    };
    const loop = (edges: number[]) => {
      const entity = id();
      entities.push(`#${entity} = EDGE_LOOP('',(${edges.map((e) => `#${e}`).join(',')}));`);
      return entity;
    };
    const face = (surface: number, outerLoop: number, innerLoops: number[] = [], sameSense = true) => {
      const outer = id();
      entities.push(`#${outer} = FACE_OUTER_BOUND('',#${outerLoop},.T.);`);
      const bounds = [outer];
      for (const inner of innerLoops) {
        const bound = id();
        entities.push(`#${bound} = FACE_BOUND('',#${inner},.T.);`);
        bounds.push(bound);
      }
      const entity = id();
      entities.push(`#${entity} = ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(',')}),#${surface},${sameSense ? '.T.' : '.F.'});`);
      return entity;
    };

    // Four shared seam vertices and the eight end circles/edges.
    const vOuterBottom = vertex([Ro, 0, 0]);
    const vOuterTop = vertex([Ro, 0, L]);
    const vInnerBottom = vertex([Ri, 0, 0]);
    const vInnerTop = vertex([Ri, 0, L]);

    const circleOuterBottom = circle([0, 0, 0], Ro);
    const circleOuterTop = circle([0, 0, L], Ro);
    const circleInnerBottom = circle([0, 0, 0], Ri);
    const circleInnerTop = circle([0, 0, L], Ri);

    const edgeOuterBottom = circleEdge(circleOuterBottom, vOuterBottom);
    const edgeOuterTop = circleEdge(circleOuterTop, vOuterTop);
    const edgeInnerBottom = circleEdge(circleInnerBottom, vInnerBottom);
    const edgeInnerTop = circleEdge(circleInnerTop, vInnerTop);

    const seamOuter = lineEdge([Ro, 0, 0], [Ro, 0, L], vOuterBottom, vOuterTop);
    const seamInner = lineEdge([Ri, 0, 0], [Ri, 0, L], vInnerBottom, vInnerTop);

    const surfOuter = cylinder(Ro);
    const surfInner = cylinder(Ri);
    const surfBottom = plane([0, 0, 0], [0, 0, -1]);
    const surfTop = plane([0, 0, L], [0, 0, 1]);

    // Outer cylinder: outward normal.
    const outerLoop = loop([
      oriented(edgeOuterBottom, true),
      oriented(seamOuter, true),
      oriented(edgeOuterTop, false),
      oriented(seamOuter, false),
    ]);
    const outerFace = face(surfOuter, outerLoop, [], true);

    // Inner cylinder: inward normal, shared edges reversed relative to the annuli.
    const innerLoop = loop([
      oriented(edgeInnerBottom, false),
      oriented(seamInner, false),
      oriented(edgeInnerTop, true),
      oriented(seamInner, true),
    ]);
    const innerFace = face(surfInner, innerLoop, [], false);

    // Bottom annulus: outer loop clockwise from +Z, inner hole counter-clockwise.
    const bottomOuter = loop([oriented(edgeOuterBottom, false)]);
    const bottomInner = loop([oriented(edgeInnerBottom, true)]);
    const bottomFace = face(surfBottom, bottomOuter, [bottomInner], true);

    // Top annulus: outer loop counter-clockwise from +Z, inner hole clockwise.
    const topOuter = loop([oriented(edgeOuterTop, true)]);
    const topInner = loop([oriented(edgeInnerTop, false)]);
    const topFace = face(surfTop, topOuter, [topInner], true);

    const shell = id();
    entities.push(`#${shell} = CLOSED_SHELL('',(#${outerFace},#${innerFace},#${bottomFace},#${topFace}));`);
    const solid = id();
    entities.push(`#${solid} = MANIFOLD_SOLID_BREP(${stepString(name)},#${shell});`);
    solids.push(solid);
  }

  const representation = id();
  entities.push(`#${representation} = ADVANCED_BREP_SHAPE_REPRESENTATION(${stepString(productName)},(${solids.map((s) => `#${s}`).join(',')}),#${context});`);
  const shapeDefinition = id();
  entities.push(`#${shapeDefinition} = SHAPE_DEFINITION_REPRESENTATION(#${productShape},#${representation});`);

  const now = new Date().toISOString();
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${stepString('CPPR Studio smooth tube STEP export')}),'2;1');`,
    `FILE_NAME(${stepString(fileName)},'${now}',(${stepString('CPPR Studio')}),(${stepString('CPPR Studio')}),'CPPR Studio','CPPR Studio','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
    'ENDSEC;',
    'DATA;',
  ];
  return [...header, ...entities, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n') + '\n';
}
