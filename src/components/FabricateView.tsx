import { useMemo, useState } from 'react';
import type { Project, RobotResult, SegmentConfig, SegmentResult } from '../core/types';
import { buildAssemblyStl, buildSegmentTubes, type SegmentFab } from '../core/fab/build';
import { meshToStlBinary } from '../core/fab/tubeMesh';
import { effectiveTransmissionPattern, transmissionDesign } from '../core/fab/transmission';
import { buildLaserPatterns, patternToDxf, patternToSvg } from '../core/fab/patterns';
import { buildReportHtml, designJson, notchesCsv } from '../core/export/report';
import { Button, Chip, Icon } from './ui';
import { downloadBlob, downloadText, formatBytes, makeZip, slugify, type ZipEntry } from '../lib/files';

interface Props {
  project: Project;
  result: RobotResult;
  onImport: () => void;
  onNew: () => void;
  onExamples: () => void;
}

interface Row {
  cfg: SegmentConfig;
  res: SegmentResult;
  active: SegmentFab;
  full: SegmentFab;
}

export function FabricateView({ project, result, onImport, onNew, onExamples }: Props) {
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const cfg of project.segments) {
      if (!cfg.enabled) continue;
      const res = result.segments.find((r) => r.segmentId === cfg.id);
      if (!res || !res.designState) continue;
      const active = buildSegmentTubes(cfg, res, { includeTransmission: false });
      const full = cfg.transmission.length > 0 ? buildSegmentTubes(cfg, res, { includeTransmission: true }) : active;
      out.push({ cfg, res, active, full });
    }
    return out;
  }, [project, result]);

  const patterns = useMemo(
    () => rows.flatMap((r) => buildLaserPatterns(r.cfg, r.res, true)),
    [rows],
  );
  const slug = slugify(project.name);
  const totalTriangles = useMemo(
    () => rows.reduce((a, r) => a
      + r.active.outer.mesh.triangles.length / 3 + r.active.inner.mesh.triangles.length / 3
      + r.full.outer.mesh.triangles.length / 3 + r.full.inner.mesh.triangles.length / 3
      + (r.full.couplers.outer?.mesh.triangles.length ?? 0) / 3 + (r.full.couplers.inner?.mesh.triangles.length ?? 0) / 3, 0),
    [rows],
  );
  const tipPlate = useMemo(
    () => (rows.length ? buildAssemblyStl(rows.map((r) => ({ cfg: r.cfg, res: r.res, fab: r.active })), `${project.name} — tip only`, 200) : null),
    [rows, project.name],
  );

  /** All complete tubes on one (print-oriented) build plate. Built lazily because it is large. */
  const buildCompletePlate = () =>
    rows.length
      ? buildAssemblyStl(rows.map((r) => ({ cfg: r.cfg, res: r.res, fab: r.full })), `${project.name} — complete`, 200)
      : null;

  const downloadCompletePlate = () => {
    if (busy) return;
    setBusy(true);
    try {
      const p = buildCompletePlate();
      if (!p) return;
      downloadBlob(`${slug}_complete_print_plate.stl`, new Blob([p.content as unknown as BlobPart], { type: 'model/stl' }));
    } finally {
      setBusy(false);
    }
  };

  const disabled = !result.ok || rows.length === 0;
  const [busy, setBusy] = useState(false);

  const downloadStl = (row: Row, which: 'outer' | 'inner', full: boolean) => {
    const fab = full ? row.full : row.active;
    const tube = which === 'outer' ? fab.outer : fab.inner;
    const name = `${slug}_${slugify(row.cfg.name)}_${which}${full ? '_full_flex' : '_active'}.stl`;
    downloadBlob(name, new Blob([meshToStlBinary(tube.mesh, tube.label, tube.od / 2) as unknown as BlobPart], { type: 'model/stl' }));
  };

  const downloadCoupler = (row: Row, which: 'outer' | 'inner') => {
    const coupler = which === 'outer' ? row.full.couplers.outer : row.full.couplers.inner;
    if (!coupler) return;
    const name = `${slug}_${slugify(row.cfg.name)}_${which}_coupler.stl`;
    downloadBlob(name, new Blob([meshToStlBinary(coupler.mesh, coupler.label, coupler.od / 2) as unknown as BlobPart], { type: 'model/stl' }));
  };

  const downloadAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
    const entries: ZipEntry[] = [];
    for (const row of rows) {
      for (const which of ['outer', 'inner'] as const) {
        const tube = which === 'outer' ? row.active.outer : row.active.inner;
        entries.push({
          name: `stl/${slug}_${slugify(row.cfg.name)}_${which}_active.stl`,
          content: meshToStlBinary(tube.mesh, tube.label, tube.od / 2),
        });
        if (row.full !== row.active) {
          const ft = which === 'outer' ? row.full.outer : row.full.inner;
          entries.push({
            name: `stl/${slug}_${slugify(row.cfg.name)}_${which}_full_flex.stl`,
            content: meshToStlBinary(ft.mesh, ft.label, ft.od / 2),
          });
          const coupler = which === 'outer' ? row.full.couplers.outer : row.full.couplers.inner;
          if (coupler) {
            entries.push({
              name: `stl/${slug}_${slugify(row.cfg.name)}_${which}_coupler.stl`,
              content: meshToStlBinary(coupler.mesh, coupler.label, coupler.od / 2),
            });
          }
        }
      }
    }
    if (tipPlate) entries.push({ name: `stl/${slug}_tip_print_plate.stl`, content: tipPlate.content });
    const completePlate = buildCompletePlate();
    if (completePlate) entries.push({ name: `stl/${slug}_complete_print_plate.stl`, content: completePlate.content });
    entries.push({ name: `laser/${slug}_patterns.svg`, content: patternToSvg(patterns, project.name, 'Unrolled notch and transmission patterns') });
    entries.push({ name: `laser/${slug}_patterns.dxf`, content: patternToDxf(patterns) });
    entries.push({ name: `docs/${slug}_design_report.html`, content: buildReportHtml(project, result) });
    entries.push({ name: `docs/${slug}_notch_schedule.csv`, content: notchesCsv(project, result) });
    entries.push({ name: `${slug}_design.json`, content: designJson(project, result) });
    entries.push({ name: 'README.txt', content: readme(project.name, rows) });
    downloadBlob(`${slug}_cppr_package.zip`, await makeZip(entries));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fab-scroll">
      <div className="fab-hero">
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h2>Fabricate this robot</h2>
            <p>
              Every file is generated from the same model and notch schedule. Print the complete tubes or just the notched tip sections, or laser-cut the
              unrolled patterns from tube stock. Check the strain and clearance warnings before committing material.
            </p>
          </div>
          <div className="flex gap6">
            <Button variant="primary" icon="package" onClick={downloadAll} disabled={disabled || busy} title="All complete and tip tubes, both build plates, laser SVG/DXF, report, CSV and project JSON">{busy ? 'Preparing…' : 'Download everything (.zip)'}</Button>
          </div>
        </div>
        <div className="pill-row" style={{ marginTop: 10 }}>
          <Chip tone={result.ok ? 'ok' : 'err'} icon={result.ok ? 'check' : 'error'}>{result.ok ? 'Design complete' : `${result.errors.length} blocking issue${result.errors.length === 1 ? '' : 's'}`}</Chip>
          <Chip tone="gray" icon="cube">{rows.length} tube pair{rows.length === 1 ? '' : 's'}</Chip>
          <Chip tone="gray" icon="layers">{rows.length * 4} tube STLs + 2 plates</Chip>
          <Chip tone="gray" icon="zap">{patterns.reduce((a, p) => a + p.regions.length + p.holes.length, 0)} laser cuts</Chip>
        </div>
      </div>

      {disabled && (
        <div className="callout err" style={{ maxWidth: 900, marginBottom: 14 }}>
          <b>Fix the design before exporting.</b> {result.errors[0] ?? 'No segment could be designed.'}
        </div>
      )}

      <div className="fab-grid">
        <div className="fab-card">
          <h3><Icon name="cube" /> 3D printing</h3>
          <p>
            Print each tube horizontally with the layers running along the axis. <b>Complete tube</b> files include the transmission
            section <b>and</b> the active notch pattern; solid proximal extensions are included, and any coupler sleeves are separate parts. <b>Tip-only</b>
            files omit the transmission. Align the distal tips when assembling; the inner handle then protrudes behind the base. The full-tube mesh uses a 5° angular approximation of the laser pattern.
          </p>
          {tipPlate && (() => {
            const usedW = Math.max(55, ...tipPlate.layout.map((l) => l.x + l.width)) + 22;
            const usedH = Math.max(60, ...tipPlate.layout.map((l) => l.y + l.height)) + 5;
            return (
            <svg viewBox={`0 0 ${usedW} ${usedH}`} style={{ width: '100%', height: 150, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 7 }}>
              {tipPlate.layout.map((l, i) => (
                <g key={i}>
                  <rect x={l.x} y={l.y} width={Math.max(1.2, l.width)} height={Math.max(1.2, Math.min(196, l.height))} fill={i % 2 ? '#bfdbfe' : '#c7d2fe'} stroke="#2563eb" strokeWidth={0.4} rx={Math.min(1, l.width / 4)} />
                </g>
              ))}
              <text x={4} y={usedH - 3} fontSize={Math.max(2.5, usedW * 0.025)} fill="#94a3b8">{tipPlate.layout.length} tip parts · print-oriented · bed 200 × 200 mm</text>
            </svg>
            );
          })()}
          <div className="fab-list">
            {rows.map((r) => {
              const txO = transmissionDesign(r.cfg, 'outer').meta;
              const txI = transmissionDesign(r.cfg, 'inner').meta;
              const nSlots = txO.slotCount + txI.slotCount;
              const minFeature = Math.min(txO.minFeature || 99, txI.minFeature || 99);
              return (
                <div className="fab-item" key={r.cfg.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <div className="flex" style={{ gap: 8 }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="fab-item-title">{r.cfg.name}</div>
                      <div className="faint tiny">
                        tip {r.active.outer.totalLength.toFixed(0)} mm · full outer {r.full.outer.totalLength.toFixed(0)} mm
                        {r.full.inner.totalLength !== r.full.outer.totalLength ? ` · full inner ${r.full.inner.totalLength.toFixed(0)} mm (+${r.cfg.innerExtension} handle)` : ''}
                        {(r.cfg.outerExtension ?? 0) > 0 ? ` · +${r.cfg.outerExtension} outer extension` : ''}
                        {r.full.couplers.outer || r.full.couplers.inner ? ` · ${r.cfg.transmission.coupler.length} mm coupler` : ''}
                        {nSlots > 0 ? ` · ${nSlots} transmission slots` : r.cfg.transmission.pattern === 'solid' ? ' · solid transmission' : ''}{r.cfg.tipFeature?.enabled ? ` · +${r.cfg.tipFeature.extension} tip cross-pin` : ''}
                      </div>
                    </div>
                  </div>
                  <SectionMap
                    tube="Outer"
                    extension={r.cfg.outerExtension ?? 0}
                    transmission={r.cfg.transmission.length}
                    active={r.res.activeTubeLength}
                    flex={effectiveTransmissionPattern(r.cfg, 'outer') !== 'solid'}
                    tipExtension={r.cfg.tipFeature?.enabled ? r.cfg.tipFeature.extension : 0}
                    coupler={!!r.full.couplers.outer}
                  />
                  <SectionMap
                    tube="Inner"
                    extension={r.cfg.innerExtension}
                    transmission={r.cfg.transmission.length}
                    active={r.res.activeTubeLength}
                    flex={effectiveTransmissionPattern(r.cfg, 'inner') !== 'solid'}
                    tipExtension={r.cfg.tipFeature?.enabled ? r.cfg.tipFeature.extension : 0}
                    coupler={!!r.full.couplers.inner}
                  />
                  <div className="flex gap4" style={{ justifyContent: 'space-between' }}>
                    <span className="faint tiny" style={{ width: 116, lineHeight: 1.25 }}>
                      Complete tube<br /><span style={{ fontSize: 9 }}>+ transmission{ r.cfg.innerExtension > 0 ? ' + handle' : ''}</span>
                    </span>
                    <div className="flex gap4">
                      <Button size="xs" variant="primary" onClick={() => downloadStl(r, 'outer', true)} disabled={r.full === r.active}>Outer</Button>
                      <Button size="xs" variant="primary" onClick={() => downloadStl(r, 'inner', true)} disabled={r.full === r.active}>Inner</Button>
                    </div>
                  </div>
                  {(r.full.couplers.outer || r.full.couplers.inner) && (
                    <div className="flex gap4" style={{ justifyContent: 'space-between' }}>
                      <span className="faint tiny" style={{ width: 116, lineHeight: 1.25 }}>
                        Coupler<br /><span style={{ fontSize: 9 }}>separate sleeve</span>
                      </span>
                      <div className="flex gap4">
                        {r.full.couplers.outer && <Button size="xs" variant="ghost" onClick={() => downloadCoupler(r, 'outer')}>Outer</Button>}
                        {r.full.couplers.inner && <Button size="xs" variant="ghost" onClick={() => downloadCoupler(r, 'inner')}>Inner</Button>}
                      </div>
                    </div>
                  )}
                  <div className="flex gap4" style={{ justifyContent: 'space-between' }}>
                    <span className="faint tiny" style={{ width: 116, lineHeight: 1.25 }}>
                      Tip only<br /><span style={{ fontSize: 9 }}>no transmission</span>
                    </span>
                    <div className="flex gap4">
                      <Button size="xs" onClick={() => downloadStl(r, 'outer', false)}>Outer</Button>
                      <Button size="xs" onClick={() => downloadStl(r, 'inner', false)}>Inner</Button>
                    </div>
                  </div>
                  {nSlots > 0 && minFeature < 0.4 && (
                    <div className="tiny" style={{ color: '#b45309' }}>
                      Smallest transmission feature {minFeature.toFixed(2)} mm — below a typical FDM nozzle. Increase the kerf/pitch or use laser cutting.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="actions">
            <Button size="sm" variant="primary" icon="download" onClick={downloadCompletePlate} disabled={busy}>{busy ? 'Preparing…' : 'Complete build plate'}</Button>
            {tipPlate && <Button size="sm" icon="download" onClick={() => downloadBlob(`${slug}_tip_print_plate.stl`, new Blob([tipPlate.content as unknown as BlobPart], { type: 'model/stl' }))}>Tip-only build plate</Button>}
            <Button size="sm" variant="ghost" icon="package" onClick={downloadAll} disabled={disabled || busy}>{busy ? 'Preparing…' : 'Everything (.zip)'}</Button>
            <span className="meta">{Math.round(totalTriangles).toLocaleString()} triangles total</span>
          </div>
          <p className="meta">
            The <b>active bending section is the notched tip</b>; the long proximal section is the transmission that reaches back to the base.
            The section maps show handle (purple), solid transmission (grey), flex transmission (blue), active notches (orange) and the optional tip cross-pin extension (green).
            The <b>complete-tube</b> STL includes all of it; the <b>tip-only</b> STL omits the transmission and handle.
          </p>
        </div>

        <div className="fab-card">
          <h3><Icon name="zap" /> Laser cutting</h3>
          <p>Unrolled 1:1 pattern of every notch and transmission slot, with a cut/reference layer. Trace the rectangles through the wall.</p>
          <div className="fab-list">
            {patterns.map((p) => (
              <div className="fab-item" key={p.key}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="fab-item-title">{p.label}</div>
                  <div className="faint tiny">⌀{(p.radius * 2).toFixed(2)} mm · {p.regions.length + p.holes.length} cuts · {p.length.toFixed(0)} mm</div>
                </div>
                <div className="flex gap4">
                  <Button size="xs" onClick={() => downloadText(`${slug}_${p.tube}_${slugify(p.label)}.svg`, patternToSvg([p], project.name, p.label), 'image/svg+xml')}>SVG</Button>
                  <Button size="xs" variant="ghost" onClick={() => downloadText(`${slug}_${p.tube}_${slugify(p.label)}.dxf`, patternToDxf([p]), 'application/dxf')}>DXF</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="actions">
            <Button size="sm" icon="download" onClick={() => downloadText(`${slug}_patterns.svg`, patternToSvg(patterns, project.name, 'Unrolled notch and transmission patterns'), 'image/svg+xml')}>SVG (all)</Button>
            <Button size="sm" icon="download" onClick={() => downloadText(`${slug}_patterns.dxf`, patternToDxf(patterns), 'application/dxf')}>DXF (all)</Button>
          </div>
          <div className="callout" style={{ marginTop: 4, fontSize: 10.5 }}>
            Chord-cut designs show the outer window outline, but their flat notch floor needs a 4-axis/milling cut. Use the radial cut profile for a 3-axis laser.
          </div>
        </div>

        <div className="fab-card">
          <h3><Icon name="file" /> Documentation</h3>
          <p>A printable design report with the full notch schedule, strain table, shape comparison and fabrication notes.</p>
          <div className="actions">
            <Button size="sm" icon="external" onClick={() => openHtml(buildReportHtml(project, result))}>Open report</Button>
            <Button size="sm" icon="download" onClick={() => downloadText(`${slug}_design_report.html`, buildReportHtml(project, result), 'text/html')}>HTML</Button>
            <Button size="sm" icon="download" onClick={() => downloadText(`${slug}_notch_schedule.csv`, notchesCsv(project, result), 'text/csv')}>CSV</Button>
            <Button size="sm" icon="download" onClick={() => downloadText(`${slug}_design.json`, designJson(project, result), 'application/json')}>JSON</Button>
          </div>
          <div className="meta">Tip: use your browser's “Print → Save as PDF” on the report for a shareable document.</div>
        </div>

        <div className="fab-card">
          <h3><Icon name="save" /> Project</h3>
          <p>Save the editable project or load one from disk. Everything is local to your browser — no upload.</p>
          <div className="actions">
            <Button size="sm" icon="save" onClick={() => downloadText(`${slug}_project.json`, JSON.stringify(project, null, 2), 'application/json')}>Save project</Button>
            <Button size="sm" icon="upload" onClick={onImport}>Import</Button>
            <Button size="sm" variant="ghost" icon="sparkles" onClick={onExamples}>Examples</Button>
            <Button size="sm" variant="ghost" icon="plus" onClick={onNew}>New</Button>
          </div>
          <div className="meta">Project version {project.version} · {project.segments.length} segments · {formatBytes(new Blob([JSON.stringify(project)]).size)}</div>
        </div>
      </div>

      <div className="callout info" style={{ maxWidth: 900, marginTop: 14, fontSize: 11 }}>
        <b>Before you cut:</b> verify the actual wall thickness, modulus and strain limit of your stock; add a safety factor for surface finish and
        notch stress concentrations; deburr every cut edge; and prototype one tube pair before building a multi-segment device. The model assumes
        rigid uncut sections, pure bending at each notch, negligible friction, and no notch self-contact.
      </div>
    </div>
  );
}

function SectionMap({ tube, extension, transmission, active, flex, tipExtension = 0, coupler = false }: {
  tube: string;
  extension: number;
  transmission: number;
  active: number;
  flex: boolean;
  tipExtension?: number;
  coupler?: boolean;
}) {
  const total = Math.max(1, extension + transmission + active + tipExtension);
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#e2e8f0' }}>
        {extension > 0 && <div style={{ width: pct(extension), background: '#a78bfa' }} title={`${tube} solid extension ${extension} mm`} />}
        {coupler && extension > 0 && <div style={{ width: 3, background: '#0d9488' }} title={`${tube} coupler sleeve at the joint`} />}
        <div style={{ width: pct(transmission), background: flex ? '#60a5fa' : '#94a3b8' }} title={`${tube} transmission ${transmission} mm (${flex ? 'flex' : 'solid'})`} />
        <div style={{ width: pct(active), background: '#fb923c' }} title={`${tube} active bending section ${active.toFixed(0)} mm`} />
        {tipExtension > 0 && <div style={{ width: pct(tipExtension), background: '#10b981' }} title={`${tube} tip cross-pin extension ${tipExtension} mm`} />}
      </div>
      <div className="faint" style={{ fontSize: 9.5, marginTop: 2 }}>
        {tube}: {extension > 0 ? `${extension} solid extension · ` : ''}{transmission} {flex ? 'flex' : 'solid'} transmission · {active.toFixed(0)} active{tipExtension > 0 ? ` · +${tipExtension} tip pin` : ''}{coupler ? ' · coupler' : ''}
      </div>
    </div>
  );
}

function readme(name: string, rows: Row[]): string {
  const lines = [
    `CPPR Studio fabrication package`,
    `Project: ${name}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'Contents:',
    '  stl/    Binary STL files, print-oriented (tube axis along +Y, resting on the bed).',
    '          *_active.stl is the notched tip only (no transmission).',
    '          *_full_flex.stl is the complete tube: transmission slots + active notches (+ solid extensions).',
    '          *_coupler.stl is a separate sleeve joining a solid extension to its transmission.',
    '          *_tip_print_plate.stl lays out all tip-only tubes.',
    '          *_complete_print_plate.stl lays out all complete tubes (transmission + handles). Long tubes may need splitting.',
    '  laser/  Unrolled 1:1 SVG and DXF patterns. The red CUT layer includes active notches and transmission slots.',
    '          The pattern starts after each tube’s solid extension; align distal tips when assembling. Couplers are separate printed parts.',
    '  docs/   Printable design report and the notch schedule as CSV.',
    '',
    'Segments:',
  ];
  for (const r of rows) {
    lines.push(
      `  - ${r.cfg.name}: L ${r.cfg.activeLength} mm, ${r.cfg.notches} notches, OD ${r.cfg.outerTube.od} / ${r.cfg.innerTube.od} mm, ` +
        `cut ${r.cfg.cutType}, q_design ${r.res.qDesign.toFixed(3)} mm, tau ${r.res.tauDesign.toFixed(2)} N` +
        `${r.cfg.innerExtension > 0 ? `, inner handle +${r.cfg.innerExtension} mm` : ''}` +
        `${(r.cfg.outerExtension ?? 0) > 0 ? `, outer solid extension +${r.cfg.outerExtension} mm` : ''}` +
        `${r.cfg.transmission.coupler.enabled ? `, ${r.cfg.transmission.coupler.length} mm transmission coupler` : ''}`,
    );
  }
  lines.push(
    '',
    'Printing: lay each tube horizontally so the layers run along the tube axis. Complete-tube files include the transmission; tip-only files do not.',
    'Assembly: align the distal tips. The inner handle extension then protrudes behind the base.',
    'Laser: trace each rectangle outline through the wall. Radial-notch designs are 3-axis cuttable.',
    'Safety: this is a design aid. Validate strain, friction, tolerances and bonding with a prototype.',
  );
  return lines.join('\n');
}

function openHtml(html: string): void {
  const w = window.open('', '_blank');
  if (!w) {
    downloadText('cppr_report.html', html, 'text/html');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
