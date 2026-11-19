import { Icon, Modal } from './ui';

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Designing a concentric push–pull robot"
      subtitle="A short guide to the model, the workflow, and the fabrication assumptions."
      onClose={onClose}
      footer={<button type="button" className="btn primary" onClick={onClose}>Start designing</button>}
    >
      <div className="help-grid">
        <div>
          <h3>What is a CPPR?</h3>
          <p>
            A CPPR segment is two concentric tubes with asymmetric notches cut into opposite sides and their tips bonded together.
            Sliding one tube relative to the other changes the curvature at every notch. Varying the notch depth along the tube
            produces a variable-curvature planar shape. Nesting several pairs gives an independently actuated multi-section robot.
          </p>
          <h3>The workflow</h3>
          <ul>
            <li><b>1. Pick tube stock &amp; material.</b> Set the outer tube, the inner tube, the radial clearance and the cut profile.</li>
            <li><b>2. Describe the shape.</b> Choose a curvature profile and a peak bend radius. The active length and β set the notch density.</li>
            <li><b>3. Let the solver size the notches.</b> Each notch is made as stiff as possible without exceeding the strain limit, with the inner and outer flexural rigidities matched.</li>
            <li><b>4. Review the checks.</b> Strain utilisation, depth caps, buckling, shape fit, clearance and the achievable curvature envelope.</li>
            <li><b>5. Fabricate.</b> Export tip-only or complete-tube STLs, unrolled laser patterns, a build plate for all tubes, or the everything ZIP (all files, both plates, report and schedule).</li>
          </ul>
          <h3>Transmission sections</h3>
          <p>
            Both tubes of a pair run from the base to the tip. The proximal, un-notched part of each is its transmission: the
            outer tube's is the sheath/handle, the inner tube's is the sliding shaft. They are not extra tubes, and the active bending section is always the notched distal tip. Pattern both only
            when the pair must flex — through a curved endoscope channel or through a proximal bending section (as a distal pair
            does). A proximal pair used as a hand-held handle can keep both transmissions solid. The outer and inner patterns are
            set independently, and the inner tube can have a solid proximal handle extension for hand actuation; align the distal
            tips when assembling. A solid proximal extension can be added to the outer and/or inner tube and joined to the
            existing transmission with a separate <b>coupler sleeve</b>; the extension is part of the complete tube, while the sleeve
            is exported as its own STL.
          </p>
          <h3>Tip cross-pin</h3>
          <p>
            A short straight collar can be added to both tube tips with a diametric cross-hole (openings 180° apart). A 1.75 mm
            filament pin inserted through the assembled holes locks the inner and outer tips together; trim or melt the ends. Enable it
            on the final (distal-most) segment; the extension length, hole diameter, hole distance from the tip and clocking angle are
            adjustable. The extension and holes are included in both the printed STLs and the laser patterns.
          </p>
          <h3>3D robot view</h3>
          <p>
            The 3D robot view renders the actual notched tube meshes, including transmission slots and notch cuts, deformed into the final
            assembled configuration. A distal pair's transmission is routed back through the upstream assembled path, so it bends inside the
            proximal section. It uses environment lighting, soft contact shadows and PBR tube materials; the selected pair stays solid and the other pairs are
            ghosted. Only the accurate tube meshes are shown; the grid and axes are display helpers that can be toggled off. Use the <b>Iso</b>,
            <b>Front</b>, <b>Side</b> and <b>Top</b> presets to inspect the pose; toggle the grid and axes from the same bar.
          </p>
          <h3>Tip stiffness</h3>
          <p>
            The <b>Tip stiffness</b> view applies an adjustable point force at the distal tip and solves the assembled Cosserat chain twice:
            unloaded and loaded. The tip displacement is their difference; the panel reports directional secant stiffness F/(Δ·n),
            compliance, force/deflection angle and tip rotation. Planar 2D projects the force into the base X–Z bending plane; use full 3D
            for out-of-plane loads. Reduce the force to approach the linear tangent stiffness.
          </p>
          <h3>Fabrication and STEP</h3>
          <p>
            The Fabricate view exports the complete tubes and couplers as a faceted AP214 STEP for SolidWorks. Each part is a separate solid
            body in print orientation with millimetre units; per-part files are smaller, while <b>All parts STEP</b> is one multibody file.
            The STEP is tessellated, not a NURBS B-rep; rebuild the tube in SolidWorks from the dimensions if you need smooth surfaces.
          </p>
          <h3>Cosserat (accurate) bending</h3>
          <p>
            The right rail has a <b>Bending model</b> section (visible in every view) and the <b>3D robot</b> context bar shows the live solver status. <b>Analytic</b> is the fast design model used while sizing notches.
            <b>Cosserat</b> runs a nonlinear Cosserat rod solve over the designed notch depths and push/pull; the solver is compiled to
            WebAssembly, loaded on demand, and reports convergence, iterations, solve time and residual. <b>Planar (2D)</b> is the
            recommended mode for these planar notch schedules; turn it off for the full 3D rod model with optional gravity (slower,
            and it may return a best-effort shape if it cannot converge). The rod model uses the outer-tube material for both tubes and
            averages the notch length/spacing because the design's notches vary slightly.
          </p>
          <h3>Compare models</h3>
          <p>
            The <b>Compare models</b> tab overlays the target centreline, the analytic notch model, the Cosserat planar solution and the
            on-demand full 3D solution for the selected segment. The table reports tip error, RMS (normalized by active length), out-of-plane
            deflection, iterations, time and convergence, and highlights the closest model. The target and analytic curves follow the actuation
            slider; the full 3D solve is computed only when you press the button because it is slower. The comparison solves the selected
            section on its own; the <b>3D robot</b> view solves the assembled chain. A <b>Paper fD 1.27</b> toggle applies the paper's
            printed-prototype centroid calibration.
          </p>
          <h3>Live STL preview</h3>
          <p>
            The <b>STL preview</b> tab renders the actual printable tube meshes and updates as you edit. It shows the outer and inner
            tubes exploded (inner above outer, distal tips aligned), with handle, solid/flex transmission and active notches in
            different colors. Use it to check transmission length, slots and the active section before exporting.
          </p>
          <h3>Keyboard shortcuts</h3>
          <p><span className="kbd">Ctrl</span> + <span className="kbd">Z</span> undo · <span className="kbd">Ctrl</span> + <span className="kbd">Shift</span> + <span className="kbd">Z</span> redo · <span className="kbd">Esc</span> close dialogs</p>
        </div>
        <div>
          <h3>Model at a glance</h3>
          <div className="formula">
            γ̄ = neutral-axis offset of the notched section<br />
            κ_o = κ / (1 − γ_o κ),  κ_i = κ / (1 − γ_i κ)<br />
            τ d = E_o I_o κ_o + E_i I_i κ_i<br />
            q = Σ d_j h_j κ_o,j<br />
            ε = κ_o (R − γ̄_o)  and  κ_o (x_cut + γ̄_o)
          </div>
          <p style={{ marginTop: 8 }}>
            The notch design solves <code>α_j = d_j/(E_oI_o,j + E_iI_i,j)</code> with <code>α_j ∝ κ_j</code> and{' '}
            <code>E_oI_o,j = E_iI_i,j</code>, subject to the maximum notch strain equalling the allowable strain. This is the
            maximum-stiffness procedure from Oliver-Butler et al. (2022).
          </p>
          <h3>Practical guidance</h3>
          <ul>
            <li>Keep β near 0.5. Below ~0.35 the notch lengths make buckling more likely; above ~0.65 the arc approximation of the shape degrades.</li>
            <li>Keep the straight spacing c at least the outer radius. More notches give a better shape fit and shorter, stronger hinges.</li>
            <li>Deep notches (over 50% of OD) are normal. Check the minimum backbone against your printer or laser kerf.</li>
            <li>Printed plastics need more radial clearance (0.3–0.6 mm) than metal hypotube (0.05–0.2 mm). Print tubes horizontally, layers along the axis.</li>
            <li>Friction grows with normal force at high curvature. Deburr edges, use lubricious materials, and validate the actuation force.</li>
          </ul>
          <h3>What the model does not include</h3>
          <p>
            The notch-design model is planar and is assembled from planar sections with a roll angle. The Cosserat card can evaluate the
            designed geometry with a rod model (planar by default, full 3D optional), but it still omits friction, clearance take-up,
            notch contact, manufacturing tolerances and external loads. Always prototype before clinical or safety-critical use.
          </p>
          <h3>References</h3>
          <p style={{ fontSize: 10.5 }}>
            K. Oliver-Butler, J. A. Childs, A. Daniel, D. C. Rucker, “Concentric Push–Pull Robots: Planar Modeling and Design,”
            <i> IEEE T-RO</i> 38(2), 2022.<br />
            K. T. Dang et al., “Design of Transmission Tubes for Surgical Concentric Push-Pull Robots,” <i>ISMR</i>, 2024.
          </p>
        </div>
      </div>
      <div className="callout info" style={{ marginTop: 8 }}>
        <div className="flex gap6"><Icon name="info" className="sm" /> New here? Load the “Two-segment printed robot” example from the Examples menu and drag the actuation slider to see the model in motion.</div>
      </div>
    </Modal>
  );
}
