import { describe, expect, it } from 'vitest';
import { LASER_DEMO, PRINTED_DEMO } from '../src/core/defaults';
import { designProject } from '../src/core/design/robot';
import { buildLaserPatterns, patternToDxf, patternToSvg } from '../src/core/fab/patterns';
import { buildSegmentTubes } from '../src/core/fab/build';
import { buildReportHtml, designJson, notchesCsv } from '../src/core/export/report';

describe('fabrication exports', () => {
  const project = PRINTED_DEMO();
  const result = designProject(project);
  const cfg = project.segments[0];
  const res = result.segments[0];
  const patterns = buildLaserPatterns(cfg, res, true);

  it('designs all demo segments without errors', () => {
    expect(result.ok).toBe(true);
    expect(result.segments.length).toBe(2);
    expect(result.worldShape.length).toBeGreaterThan(10);
  });

  it('produces valid SVG with one path per cut region', () => {
    const svg = patternToSvg(patterns, project.name, 'test');
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect((svg.match(/<path /g) ?? []).length).toBe(patterns.reduce((a, p) => a + p.regions.length, 0));
    expect(svg).toContain('mm"');
  });

  it('produces a DXF with entities', () => {
    const dxf = patternToDxf(patterns);
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('ENTITIES');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
    const lines = (dxf.match(/\nLINE\n/g) ?? []).length;
    expect(lines).toBeGreaterThan(patterns.reduce((a, p) => a + p.regions.length, 0) * 3);
  });

  it('builds a printable mesh for each tube', () => {
    const fab = buildSegmentTubes(cfg, res, { includeTransmission: false });
    expect(fab.outer.mesh.triangles.length).toBeGreaterThan(100);
    expect(fab.outer.mesh.volume).toBeGreaterThan(0);
    expect(fab.inner.mesh.volume).toBeGreaterThan(0);
    expect(fab.outer.totalLength).toBeGreaterThan(cfg.activeLength * 0.9);
  });

  it('writes the report, CSV and JSON', () => {
    const html = buildReportHtml(project, result);
    expect(html).toContain('<html');
    expect(html).toContain(project.name);
    expect(html).toContain('Notch schedule');
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThan(20);
    const csv = notchesCsv(project, result);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('segment,segment_id,notch');
    expect(lines.length).toBe(1 + result.segments.reduce((a, s) => a + s.notches.length, 0));
    const json = JSON.parse(designJson(project, result));
    expect(json.generatedBy).toBe('CPPR Studio');
    expect(json.summary.segments.length).toBe(2);
  });

  it('supports radial laser patterns', () => {
    const p = LASER_DEMO();
    const r = designProject(p);
    expect(r.ok).toBe(true);
    const pats = buildLaserPatterns(p.segments[0], r.segments[0], true);
    expect(pats.length).toBe(2);
    const svg = patternToSvg(pats, p.name, 'radial');
    expect(svg).toContain('<svg');
  });
});
