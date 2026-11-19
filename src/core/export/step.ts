import type { Mesh } from '../fab/tubeMesh';

export interface StepPart {
  name: string;
  mesh: Mesh;
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

const point3 = (p: [number, number, number]) => `(${stepReal(p[0])},${stepReal(p[1])},${stepReal(p[2])})`;
const vector3 = (p: [number, number, number]) => `(${stepReal(p[0])},${stepReal(p[1])},${stepReal(p[2])})`;

/**
 * Export meshes as a STEP AP214 faceted B-rep.
 *
 * The printable tube mesh is triangulated, so the export uses planar
 * ADVANCED_FACEs with a shared edge topology. The result is a valid
 * MANIFOLD_SOLID_BREP per part (a closed faceted solid). SolidWorks imports
 * these as solid bodies; it is a tessellated STEP, not a NURBS B-rep.
 */
export function meshToStep(parts: StepPart[], fileName: string, productName = fileName): string {
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
    const points = new Map<string, number>();
    const vertices = new Map<string, number>();
    const edges = new Map<string, { id: number; a: number; b: number }>();
    const faces: number[] = [];
    const pos = part.mesh.positions;
    const tris = part.mesh.triangles;

    const pointKey = (i: number) => {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    };
    const readPoint = (i: number): [number, number, number] => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const pointId = (key: string, p: [number, number, number]) => {
      let point = points.get(key);
      if (point) return point;
      point = id();
      entities.push(`#${point} = CARTESIAN_POINT('',${point3(p)});`);
      points.set(key, point);
      return point;
    };
    const vertexId = (key: string, p: [number, number, number]) => {
      let vertex = vertices.get(key);
      if (vertex) return vertex;
      const point = pointId(key, p);
      vertex = id();
      entities.push(`#${vertex} = VERTEX_POINT('',#${point});`);
      vertices.set(key, vertex);
      return vertex;
    };
    const edgeId = (aIndex: number, bIndex: number) => {
      const aKey = pointKey(aIndex);
      const bKey = pointKey(bIndex);
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      let edge = edges.get(key);
      if (edge) return edge;
      const a = vertexId(aKey, readPoint(aIndex));
      const b = vertexId(bKey, readPoint(bIndex));
      const pa = readPoint(aIndex);
      const pb = readPoint(bIndex);
      const d: [number, number, number] = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const dir = id();
      entities.push(`#${dir} = DIRECTION('',${vector3([d[0] / len, d[1] / len, d[2] / len])});`);
      const vec = id();
      entities.push(`#${vec} = VECTOR('',#${dir},1.);`);
      const point = pointId(aKey, pa);
      const line = id();
      entities.push(`#${line} = LINE('',#${point},#${vec});`);
      const curve = id();
      entities.push(`#${curve} = EDGE_CURVE('',#${a},#${b},#${line},.T.);`);
      edge = { id: curve, a: aIndex, b: bIndex };
      edges.set(key, edge);
      return edge;
    };

    for (let t = 0; t < tris.length; t += 3) {
      const ia = tris[t];
      const ib = tris[t + 1];
      const ic = tris[t + 2];
      const a = readPoint(ia);
      const b = readPoint(ib);
      const c = readPoint(ic);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nlen = Math.hypot(nx, ny, nz);
      if (nlen < 1e-12) continue;
      nx /= nlen; ny /= nlen; nz /= nlen;
      const rlen = Math.hypot(ux, uy, uz) || 1;
      const rx = ux / rlen, ry = uy / rlen, rz = uz / rlen;

      const normal = id();
      entities.push(`#${normal} = DIRECTION('',${vector3([nx, ny, nz])});`);
      const ref = id();
      entities.push(`#${ref} = DIRECTION('',${vector3([rx, ry, rz])});`);
      const pointA = pointId(pointKey(ia), a);
      const axis = id();
      entities.push(`#${axis} = AXIS2_PLACEMENT_3D('',#${pointA},#${normal},#${ref});`);
      const plane = id();
      entities.push(`#${plane} = PLANE('',#${axis});`);

      const loopEdges: number[] = [];
      const seq: [number, number][] = [[ia, ib], [ib, ic], [ic, ia]];
      for (const [u, v] of seq) {
        const edge = edgeId(u, v);
        const same = edge.a === u && edge.b === v;
        const oriented = id();
        entities.push(`#${oriented} = ORIENTED_EDGE('',*,*,#${edge.id},${same ? '.T.' : '.F.'});`);
        loopEdges.push(oriented);
      }
      const loop = id();
      entities.push(`#${loop} = EDGE_LOOP('',(${loopEdges.map((e) => `#${e}`).join(',')}));`);
      const bound = id();
      entities.push(`#${bound} = FACE_OUTER_BOUND('',#${loop},.T.);`);
      const face = id();
      entities.push(`#${face} = ADVANCED_FACE('',(#${bound}),#${plane},.T.);`);
      faces.push(face);
    }

    const shell = id();
    entities.push(`#${shell} = CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}));`);
    const solid = id();
    entities.push(`#${solid} = MANIFOLD_SOLID_BREP(${stepString(part.name)},#${shell});`);
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
    `FILE_DESCRIPTION((${stepString('CPPR Studio faceted STEP export')}),'2;1');`,
    `FILE_NAME(${stepString(fileName)},'${now}',(${stepString('CPPR Studio')}),(${stepString('CPPR Studio')}),'CPPR Studio','CPPR Studio','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
    'ENDSEC;',
    'DATA;',
  ];
  return [...header, ...entities, 'ENDSEC;', 'END-ISO-10303-21;'].join('\n') + '\n';
}
