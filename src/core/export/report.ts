import type { Project, RobotResult, SegmentConfig, SegmentResult } from '../types';
import { findMaterial } from '../materials';
import { tightestRadius } from '../design/segment';

const esc = (s: string) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
const mm = (v: number, d = 2) => `${v.toFixed(d)} mm`;

function shapeSvg(res: SegmentResult, L: number): string {
  const pts = res.desiredShape;
  const acc = res.designState?.shape ?? [];
  if (pts.length < 2) return '';
  const all = [...pts, ...acc];
  const minX = Math.min(...all.map((p) => p.x), -1);
  const maxX = Math.max(...all.map((p) => p.x), 1);
  const minZ = Math.min(...all.map((p) => p.z), -1);
  const maxZ = Math.max(...all.map((p) => p.z), 1);
  const pad = 8;
  const w = 300;
  const scale = (w - 2 * pad) / Math.max(maxX - minX, maxZ - minZ, 1);
  const h = (maxZ - minZ) * scale + 2 * pad;
  const X = (x: number) => pad + (x - minX) * scale;
  const Y = (z: number) => h - pad - (z - minZ) * scale;
  const path = (arr: { x: number; z: number }[]) =>
    arr.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.x).toFixed(2)} ${Y(p.z).toFixed(2)}`).join(' ');
  const ticks: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const z = minZ + ((maxZ - minZ) * i) / 4;
    ticks.push(
      `<line x1="${pad}" y1="${Y(z)}" x2="${w - pad}" y2="${Y(z)}" stroke="#e5e7eb" stroke-width="0.5"/>`,
    );
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:360px" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#fff"/>
    ${ticks.join('')}
    <path d="${path(pts)}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="4 3"/>
    ${acc.length > 1 ? `<path d="${path(acc)}" fill="none" stroke="#0f172a" stroke-width="2.4"/>` : ''}
    <circle cx="${X((acc.at(-1) ?? pts.at(-1))!.x)}" cy="${Y((acc.at(-1) ?? pts.at(-1))!.z)}" r="2.4" fill="#e11d48"/>
    <text x="${pad}" y="12" font-family="Helvetica" font-size="8" fill="#475569">z ↑ · ${L.toFixed(1)} mm active length</text>
  </svg>`;
}

function notchTable(res: SegmentResult): string {
  const rows = res.notches
    .map(
      (n) => `<tr>
      <td>${n.index + 1}</td>
      <td>${n.zCenter.toFixed(2)}</td>
      <td>${n.h.toFixed(2)}</td>
      <td>${n.gOuter.toFixed(3)}</td>
      <td>${n.gInner.toFixed(3)}</td>
      <td>${n.phiOuter === 0 ? '0°' : '180°'}</td>
      <td>${(n.kappaTarget * 1000).toFixed(1)}</td>
      <td>${pct(n.strainMax)}</td>
      <td>${(n.strainUtilisation * 100).toFixed(0)}%</td>
      <td>${(n.EIOuter / 1000).toFixed(2)}</td>
      <td>${n.depthCapped ? '⚠ capped' : '—'}</td>
    </tr>`,
    )
    .join('');
  return `<table class="notches">
    <thead><tr>
      <th>#</th><th>z (mm)</th><th>h (mm)</th><th>g<sub>o</sub> (mm)</th><th>g<sub>i</sub> (mm)</th>
      <th>φ<sub>o</sub></th><th>κ (1/m)</th><th>max strain</th><th>util.</th>
      <th>EI (N mm² ×10³)</th><th>status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function buildReportHtml(project: Project, result: RobotResult): string {
  const date = new Date().toLocaleString();
  const segBlocks = project.segments
    .filter((s) => s.enabled)
    .map((cfg) => {
      const res = result.segments.find((r) => r.segmentId === cfg.id);
      if (!res) return '';
      const matO = findMaterial(project.materials, cfg.outerTube.materialId);
      const matI = findMaterial(project.materials, cfg.innerTube.materialId);
      const rmin = tightestRadius(res);
      const st = res.designState;
      return `<section class="segment">
        <h2>${esc(cfg.name)}</h2>
        <div class="grid">
          <div>
            <table class="kv">
              <tr><th>Active length L</th><td>${mm(cfg.activeLength)}</td></tr>
              <tr><th>Notches n / β</th><td>${cfg.notches} / ${cfg.beta.toFixed(3)}</td></tr>
              <tr><th>Outer tube</th><td>⌀${mm(cfg.outerTube.od)} × ${mm(cfg.outerTube.wall)} wall — ${esc(matO.name)}</td></tr>
              <tr><th>Inner tube</th><td>⌀${mm(cfg.innerTube.od)} × ${mm(cfg.innerTube.wall)} wall — ${esc(matI.name)}</td></tr>
              <tr><th>Radial clearance</th><td>${mm(res.clearance, 3)}</td></tr>
              ${cfg.innerExtension > 0 ? `<tr><th>Inner handle extension</th><td>${mm(cfg.innerExtension, 0)} solid proximal length</td></tr>` : ''}
              ${(cfg.outerExtension ?? 0) > 0 ? `<tr><th>Outer solid extension</th><td>${mm(cfg.outerExtension, 0)} solid proximal length</td></tr>` : ''}
              ${cfg.transmission.coupler?.enabled ? `<tr><th>Transmission coupler</th><td>${mm(cfg.transmission.coupler.length, 0)} sleeve · ${cfg.transmission.coupler.tubes} · wall ${mm(cfg.transmission.coupler.wall, 2)} · clearance ${mm(cfg.transmission.coupler.clearance, 2)}</td></tr>` : ''}
              ${cfg.tipFeature?.enabled ? `<tr><th>Tip cross-pin</th><td>+${mm(cfg.tipFeature.extension, 1)} mm to both tips · Ø${mm(cfg.tipFeature.holeDiameter, 2)} mm diametric hole ${mm(cfg.tipFeature.holeDistance, 1)} mm from the tip · ${mm(cfg.tipFeature.angleDeg, 0)}°</td></tr>` : ''}
              <tr><th>Cut profile</th><td>${cfg.cutType === 'chord' ? 'chord (milled/printed)' : 'radial (laser)'}</td></tr>
              <tr><th>Strain limit / FS</th><td>${pct(cfg.strainLimitOverride ?? matO.strainLimit)} / ${cfg.safetyFactor}</td></tr>
              <tr><th>Transmission length</th><td>${mm(cfg.transmission.length, 0)}</td></tr>
              <tr><th>Shape target</th><td>${esc(cfg.shape.kind === 'preset' ? cfg.shape.preset : 'custom waypoints')} · peak κ ${(cfg.shape.kappaMax * 1000).toFixed(1)} 1/m</td></tr>
            </table>
          </div>
          <div>${shapeSvg(res, cfg.activeLength)}<div style="font-size:10px;color:#64748b;text-align:center;margin-top:2px">— model shape · --- target shape · ● tip</div></div>
        </div>
        <h3>Design outcome</h3>
        <table class="kv">
          <tr><th>Actuation q</th><td>${mm(res.qDesign, 3)} (positive = pull inner tube)</td></tr>
          <tr><th>Inner-tube tension</th><td>${res.tauDesign.toFixed(2)} N</td></tr>
          <tr><th>Tip position (local)</th><td>x ${mm(st?.tip.x ?? 0)} · z ${mm(st?.tip.z ?? 0)}</td></tr>
          <tr><th>Shape fit (RMS)</th><td>${pct(res.rmsError, 1)} of L · tip error ${pct(res.tipError, 1)}</td></tr>
          <tr><th>Tightest centreline radius</th><td>${rmin ? mm(rmin, 1) : '—'}</td></tr>
          <tr><th>Curvature capacity</th><td>${res.kappaCapacity ? `${(res.kappaCapacity * 1000).toFixed(1)} 1/m (min radius ${(1 / res.kappaCapacity).toFixed(1)} mm)` : '—'}</td></tr>
          <tr><th>Physical active tube length</th><td>${mm(res.activeTubeLength)}</td></tr>
          <tr><th>Mass (active pair)</th><td>${res.mass.toFixed(2)} g</td></tr>
        </table>
        ${res.warnings.length ? `<div class="warnings"><strong>Warnings</strong><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${res.errors.length ? `<div class="errors"><strong>Errors</strong><ul>${res.errors.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${res.info.length ? `<div class="info"><strong>Notes</strong><ul>${res.info.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        <h3>Notch schedule</h3>
        ${notchTable(res)}
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${esc(project.name)} — CPPR design report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; background: #f8fafc; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 28px 64px; background: white; }
  h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: -0.02em; }
  h2 { margin-top: 34px; padding-top: 18px; border-top: 2px solid #e2e8f0; font-size: 20px; }
  h3 { margin: 20px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; }
  .meta { color: #64748b; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 1fr 360px; gap: 24px; align-items: start; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  .kv th { text-align: left; color: #64748b; font-weight: 500; padding: 4px 12px 4px 0; width: 46%; vertical-align: top; }
  .kv td { padding: 4px 0; }
  .notches { margin-top: 8px; }
  .notches th { background: #f1f5f9; text-align: left; padding: 6px; border: 1px solid #e2e8f0; font-size: 11px; }
  .notches td { padding: 5px 6px; border: 1px solid #e2e8f0; font-variant-numeric: tabular-nums; }
  .warnings, .errors, .info { margin: 14px 0; padding: 10px 14px; border-radius: 6px; font-size: 13px; }
  .warnings { background: #fff7ed; border-left: 4px solid #f59e0b; }
  .errors { background: #fef2f2; border-left: 4px solid #dc2626; }
  .info { background: #eff6ff; border-left: 4px solid #3b82f6; }
  ul { margin: 4px 0 0 18px; padding: 0; }
  .method { font-size: 12px; color: #475569; line-height: 1.55; }
  @media print {
    body { background: white; }
    main { max-width: none; padding: 0 12mm; }
    h2 { break-before: page; }
    .segment:first-of-type h2 { break-before: auto; }
  }
</style></head>
<body><main>
  <h1>${esc(project.name)}</h1>
  <div class="meta">Concentric push–pull robot design report · ${esc(date)}${project.author ? ` · ${esc(project.author)}` : ''}</div>
  <p class="method">This report was generated by CPPR Studio using the planar variable-curvature model and the maximum-stiffness notch-design procedure of Oliver-Butler et al., “Concentric Push–Pull Robots: Planar Modeling and Design,” IEEE T-RO 38(2), 2022. The transmission-pattern vocabulary follows Dang et al., “Design of Transmission Tubes for Surgical Concentric Push–Pull Robots,” ISMR 2024. Verify the design with a prototype before clinical or safety-critical use.</p>
  <h3>Robot summary</h3>
  <table class="kv">
    <tr><th>Segments / nominal actuated DOF</th><td>${result.segments.length} / ${result.dof}</td></tr>
    <tr><th>Total active length</th><td>${mm(result.totalLength, 1)}</td></tr>
    <tr><th>Design status</th><td>${result.ok ? 'All segments designed' : 'Action required — see errors'}</td></tr>
    <tr><th>System warnings</th><td>${result.warnings.length}</td></tr>
  </table>
  ${result.errors.length ? `<div class="errors"><strong>Robot errors</strong><ul>${result.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  ${result.warnings.length ? `<div class="warnings"><strong>Robot warnings</strong><ul>${result.warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  ${segBlocks}
  <h2>Fabrication notes</h2>
  <ul class="method">
    <li>3D printing: print each tube horizontally with layers running along the tube axis. The full + flex STL includes the transmission slot pattern (5° angular approximation); the active-section STL omits it.</li>
    <li>Laser cutting: use the unrolled SVG/DXF. Radial-notch designs are directly cuttable by tracing each rectangle through the wall; chord-notch designs require a 4-axis/milling process.</li>
    <li>The optional tip cross-pin extends both tube tips and cuts a diametric hole with openings 180° apart. Insert a 1.75 mm filament pin through the assembled tubes and trim or melt the ends to lock the tips. The holes are included in both the printed STLs and the laser patterns. The active bending section is the notched distal tip; the proximal transmission is the push-pull shaft that reaches back to the base. Fit its length to the upstream bend, not to an arbitrary long value.</li>
    <li>Bond the distal tips of each pair. Leave the proximal transmission sections free to slide through the lumens. The inner tube's solid handle extension is for manual pull/push and is included in the complete inner STL and pattern; align the distal tips when inserting it, so the inner handle protrudes behind the base by the extension.</li>
    <li>Verify the strain limit of the actual material lot and deburr all notch edges to reduce friction and stress concentration.</li>
  </ul>
</main></body></html>`;
}

export function notchesCsv(project: Project, result: RobotResult): string {
  const rows = [
    ['segment', 'segment_id', 'notch', 'z_center_mm', 'h_mm', 'l_mm', 'g_outer_mm', 'g_inner_mm',
      'phi_outer_deg', 'phi_inner_deg', 'kappa_target_1_per_mm', 'strain_outer_backbone', 'strain_outer_cut',
      'strain_inner_backbone', 'strain_inner_cut', 'strain_max', 'EI_outer_Nmm2', 'EI_inner_Nmm2', 'buckling_ratio'],
  ];
  for (const cfg of project.segments) {
    const res = result.segments.find((r) => r.segmentId === cfg.id);
    if (!res) continue;
    for (const n of res.notches) {
      rows.push([
        cfg.name,
        cfg.id,
        String(n.index + 1),
        n.zCenter.toFixed(4),
        n.h.toFixed(4),
        n.l.toFixed(4),
        n.gOuter.toFixed(4),
        n.gInner.toFixed(4),
        (n.phiOuter * 180 / Math.PI).toFixed(1),
        (n.phiInner * 180 / Math.PI).toFixed(1),
        (n.kappaTarget * 1000).toFixed(3),
        n.strainOuterBackbone.toExponential(4),
        n.strainOuterCut.toExponential(4),
        n.strainInnerBackbone.toExponential(4),
        n.strainInnerCut.toExponential(4),
        n.strainMax.toExponential(4),
        n.EIOuter.toFixed(2),
        n.EIInner.toFixed(2),
        n.bucklingRatio.toFixed(3),
      ]);
    }
  }
  return rows.map((r) => r.map((c) => (c.includes(',') ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

export function designJson(project: Project, result: RobotResult): string {
  return JSON.stringify(
    {
      generatedBy: 'CPPR Studio',
      generatedAt: new Date().toISOString(),
      project,
      summary: {
        ok: result.ok,
        dof: result.dof,
        totalLength: result.totalLength,
        segments: result.segments.map((r) => ({
          id: r.segmentId,
          ok: r.ok,
          qDesign: r.qDesign,
          tauDesign: r.tauDesign,
          rmsError: r.rmsError,
          kappaCapacity: r.kappaCapacity,
          clearance: r.clearance,
          notches: r.notches,
          warnings: r.warnings,
          errors: r.errors,
        })),
      },
    },
    null,
    2,
  );
}

export type { SegmentConfig };
