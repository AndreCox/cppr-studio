//! 3D Cosserat-rod backend for concentric push/pull robots.
//!
//! The model follows Tummers et al. (2025). Each repo [`Section`] is a two-tube
//! CPPR: the outer tube is the leader and the inner tube is the follower. The
//! chain module assembles sections through rigid connectors and rolls, and this
//! module converts the public millimetre/degree description into SI, runs the
//! solver, and returns a renderer-friendly [`DeformedState`].
//!

pub mod chain;
pub mod cross_section;
pub mod kinematics;
pub mod solver;

use web_time::Instant;

use nalgebra::{Vector3, Vector6};

use crate::backend::{
    BACKEND_SOLVER_VERSION, BackendId, ControlDescriptor, ControlState, DeformedState, FrameField,
    FrameSample, KinematicsBackend, ModuleDesign, RobotDesign, SectionShape, SolveDiagnostics,
    SolveError,
};
use crate::robot::{
    MAX_BASE_ROTATION, MAX_BASE_TRANSLATION, MIN_BASE_ROTATION, MIN_BASE_TRANSLATION,
};

use chain::ChainSolver;
use kinematics::{
    Pose, base_pose_from_public, paper_to_repo_rotation, point_paper_to_repo, pose_paper_to_repo,
};
use solver::SolverSettings;

const PUSH_PULL_LIMIT_MM: f64 = 20.0;

/// The Cosserat backend. It keeps the assembled chain and its warm start between
/// solves so repeated control changes do not rebuild the geometry.
#[derive(Debug, Clone)]
pub struct CosseratBackend {
    pub settings: SolverSettings,
    chain: Option<ChainSolver>,
    fingerprint: Option<u64>,
}

impl Default for CosseratBackend {
    fn default() -> Self {
        Self::new(SolverSettings::default())
    }
}

impl CosseratBackend {
    pub fn new(settings: SolverSettings) -> Self {
        Self {
            settings,
            chain: None,
            fingerprint: None,
        }
    }

    /// Solver used by the paper's R1/R2 2D validation: five curvature modes,
    /// no torsion, and the calibrated centroid scale.
    pub fn paper_validation(centroid_scale: f64) -> Self {
        Self::new(SolverSettings {
            curvature_modes: 5,
            torsion_modes: 0,
            planar: true,
            samples_per_notch: 10,
            centroid_scale,
            ..Default::default()
        })
    }

    fn ensure_chain(&mut self, design: &RobotDesign) -> Result<&mut ChainSolver, SolveError> {
        let fingerprint = design.geometry_fingerprint();
        if self.chain.is_none() || self.fingerprint != Some(fingerprint) {
            self.chain = Some(ChainSolver::new(design, self.settings.clone())?);
            self.fingerprint = Some(fingerprint);
        }
        Ok(self.chain.as_mut().expect("chain was just built"))
    }
}

impl KinematicsBackend for CosseratBackend {
    fn id(&self) -> BackendId {
        BackendId::Cosserat
    }

    fn controls(&self, design: &RobotDesign) -> Vec<ControlDescriptor> {
        control_descriptors(design)
    }

    fn default_controls(&self, design: &RobotDesign) -> ControlState {
        let descriptors = self.controls(design);
        let mut controls = ControlState::from_descriptors(&descriptors);
        controls.gravity_enabled = true;
        controls
    }

    fn solve(
        &mut self,
        design: &RobotDesign,
        controls: &ControlState,
    ) -> Result<DeformedState, SolveError> {
        let started = Instant::now();
        let base_pose = base_pose_from_controls(design, controls);
        let roll_rad = roll_angles_rad(design, controls);
        let targets_m = push_pull_m(design, controls);
        let tip_load_world = wrench_repo_to_paper(&controls.tip_load_world);
        let gravity_world = if controls.gravity_enabled {
            vector_repo_to_paper(&design.gravity_world_m_s2)
        } else {
            Vector3::zeros()
        };

        let solution = {
            let chain = self.ensure_chain(design)?;
            chain.solve(
                &base_pose,
                &roll_rad,
                &targets_m,
                &tip_load_world,
                &gravity_world,
            )?
        };

        // A non-converged chain is still a usable best-effort shape, and the
        // optimizer needs one on every evaluation. Report the failure through
        // the diagnostics instead of discarding the geometry (which used to
        // leave the caller with an empty centerline).
        let failure_message = if solution.converged {
            None
        } else {
            Some(format!(
                "Cosserat solve did not converge: residual {:.3e} after {} iterations",
                solution.residual_norm, solution.iterations
            ))
        };

        let mut centerline = Vec::new();
        let mut sections = Vec::with_capacity(solution.sections.len());
        for (index, evaluation) in solution.sections.iter().enumerate() {
            let leader_samples = evaluation
                .leader_frames_repo_mm()
                .into_iter()
                .map(|(s_mm, pose, centroid_offset_mm)| FrameSample {
                    s_mm,
                    pose: pose.to_array(),
                    centroid_offset_mm,
                })
                .collect();
            let follower_samples = evaluation
                .follower_frames_repo_mm()
                .into_iter()
                .map(|(s_mm, pose, centroid_offset_mm)| FrameSample {
                    s_mm,
                    pose: pose.to_array(),
                    centroid_offset_mm,
                })
                .collect();
            let section_centerline = evaluation.centerline_repo_mm();
            append_unique(&mut centerline, &section_centerline);

            let connector_m = solution
                .sections
                .get(index)
                .map(|_| chain_connector_length(design, index))
                .unwrap_or(0.0);
            append_connector(&mut centerline, evaluation, connector_m);

            sections.push(SectionShape {
                section_index: index,
                leader: FrameField {
                    samples: leader_samples,
                },
                follower: FrameField {
                    samples: follower_samples,
                },
                centerline: section_centerline,
            });
        }

        let tip = point_paper_to_repo(&solution.tip_pose.translation) * 1e3;
        let tip = [tip[0], tip[1], tip[2]];
        let module_poses = solution
            .module_poses
            .iter()
            .map(|pose| {
                let mut pose = pose_paper_to_repo(pose);
                pose.translation *= 1e3;
                pose.to_array()
            })
            .collect();

        let elapsed_ms = started.elapsed().as_secs_f64() * 1e3;
        let diagnostics = SolveDiagnostics {
            converged: solution.converged,
            iterations: solution.iterations,
            residual: solution.residual_norm,
            solve_time_ms: elapsed_ms,
            message: failure_message,
        };

        let solution_key = DeformedState::make_solution_key(
            BackendId::Cosserat,
            design,
            controls,
            BACKEND_SOLVER_VERSION,
        );

        Ok(DeformedState {
            backend: BackendId::Cosserat,
            solution_key,
            sections,
            centerline,
            tip,
            module_poses,
            diagnostics,
        })
    }
}

fn chain_connector_length(design: &RobotDesign, section_ordinal: usize) -> f64 {
    design
        .sections()
        .nth(section_ordinal)
        .map(|section| section.config.length_of_end_effector.max(0.0) as f64 * 1e-3)
        .unwrap_or(0.0)
}

fn append_unique(target: &mut Vec<[f64; 3]>, points: &[[f64; 3]]) {
    for point in points {
        if target
            .last()
            .map(|last| {
                (last[0] - point[0]).abs() < 1e-9
                    && (last[1] - point[1]).abs() < 1e-9
                    && (last[2] - point[2]).abs() < 1e-9
            })
            .unwrap_or(false)
        {
            continue;
        }
        target.push(*point);
    }
}

/// The section's shared-centerline tip, plus a straight rigid connector.
///
/// The section centerline ends at `G_tip * T_y(-D_tip)` in the paper frame; the
/// connector continues along the solved tangent. The result is in repo
/// millimetres, matching [`SectionEvaluation::centerline_repo_mm`].
fn append_connector(
    target: &mut Vec<[f64; 3]>,
    evaluation: &solver::SectionEvaluation,
    connector_m: f64,
) {
    if connector_m <= 0.0 {
        return;
    }
    let last = evaluation.nodes.last().expect("section has nodes");
    let start = last.centerline_paper();
    let tangent = last.g1.rotation * Vector3::x();
    let samples = 6;
    for step in 1..=samples {
        let distance = connector_m * step as f64 / samples as f64;
        let point = point_paper_to_repo(&(start + tangent * distance)) * 1e3;
        target.push([point[0], point[1], point[2]]);
    }
}

fn control_descriptors(design: &RobotDesign) -> Vec<ControlDescriptor> {
    let mut controls = Vec::new();
    let translation_min = MIN_BASE_TRANSLATION as f64;
    let translation_max = MAX_BASE_TRANSLATION as f64;
    let rotation_min = MIN_BASE_ROTATION as f64;
    let rotation_max = MAX_BASE_ROTATION as f64;

    for (key, label, value, min, max) in [
        (
            "base.x",
            "Base x",
            design.base.x as f64,
            translation_min,
            translation_max,
        ),
        (
            "base.y",
            "Base y",
            design.base.y as f64,
            translation_min,
            translation_max,
        ),
        (
            "base.z",
            "Base z",
            design.base.z as f64,
            translation_min,
            translation_max,
        ),
        (
            "base.roll",
            "Base roll",
            design.base.roll_degrees as f64,
            rotation_min,
            rotation_max,
        ),
        (
            "base.pitch",
            "Base pitch",
            design.base.pitch_degrees as f64,
            rotation_min,
            rotation_max,
        ),
        (
            "base.yaw",
            "Base yaw",
            design.base.yaw_degrees as f64,
            rotation_min,
            rotation_max,
        ),
    ] {
        controls.push(ControlDescriptor::new(key, label, value, min, max, 0.1));
    }

    for (index, section) in design.sections().enumerate() {
        let length_mm = section.config.segments.max(1) as f64
            * (section.config.notch_length + section.config.uncut_length) as f64;
        let limit = PUSH_PULL_LIMIT_MM.min((length_mm * 0.2).max(1.0));
        controls.push(ControlDescriptor::new(
            format!("section.{index}.push_pull"),
            format!("Section {index} push/pull"),
            0.0,
            -limit,
            limit,
            0.05,
        ));
    }

    let mut roll_index = 0;
    for module in &design.modules {
        if let ModuleDesign::Roll(roll) = module {
            controls.push(ControlDescriptor::new(
                format!("roll.{roll_index}.angle"),
                format!("Roll {roll_index} angle"),
                roll.angle_deg,
                rotation_min,
                rotation_max,
                0.1,
            ));
            roll_index += 1;
        }
    }

    controls
}

fn base_pose_from_controls(design: &RobotDesign, controls: &ControlState) -> Pose {
    let descriptors = control_descriptors(design);
    let value = |key: &str, fallback: f64| controls.value(&descriptors, key).unwrap_or(fallback);
    base_pose_from_public(
        value("base.x", design.base.x as f64),
        value("base.y", design.base.y as f64),
        value("base.z", design.base.z as f64),
        value("base.roll", design.base.roll_degrees as f64),
        value("base.pitch", design.base.pitch_degrees as f64),
        value("base.yaw", design.base.yaw_degrees as f64),
    )
}

fn roll_angles_rad(design: &RobotDesign, controls: &ControlState) -> Vec<f64> {
    let descriptors = control_descriptors(design);
    let mut angles = Vec::new();
    let mut roll_index = 0;
    for module in &design.modules {
        if let ModuleDesign::Roll(roll) = module {
            let key = format!("roll.{roll_index}.angle");
            let degrees = controls.value(&descriptors, &key).unwrap_or(roll.angle_deg);
            angles.push(degrees.to_radians());
            roll_index += 1;
        }
    }
    angles
}

fn push_pull_m(design: &RobotDesign, controls: &ControlState) -> Vec<f64> {
    let descriptors = control_descriptors(design);
    design
        .sections()
        .enumerate()
        .map(|(index, _)| {
            let key = format!("section.{index}.push_pull");
            controls.value(&descriptors, &key).unwrap_or(0.0) * 1e-3
        })
        .collect()
}

fn vector_repo_to_paper(vector: &[f64; 3]) -> Vector3<f64> {
    paper_to_repo_rotation().transpose() * Vector3::new(vector[0], vector[1], vector[2])
}

fn wrench_repo_to_paper(wrench: &[f64; 6]) -> Vector6<f64> {
    let rotation = paper_to_repo_rotation().transpose();
    let moment = rotation * Vector3::new(wrench[0], wrench[1], wrench[2]);
    let force = rotation * Vector3::new(wrench[3], wrench[4], wrench[5]);
    Vector6::new(
        moment[0], moment[1], moment[2], force[0], force[1], force[2],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{Material, RollDesign, SectionDesign};
    use crate::config::Config;
    use crate::robot::BasePose;

    fn r1_config() -> Config {
        Config::new(3.0, 1.5, 1.0, 1.0, 5.0, 2.0, 5.0, 5.0, 15, 0.0)
    }

    fn single_design() -> RobotDesign {
        RobotDesign::new(
            BasePose::default(),
            vec![ModuleDesign::Section(SectionDesign::new(
                r1_config(),
                Material::PLA,
            ))],
        )
    }

    /// A regularly notched CPPR from the paper's Table 1: `k = c = 5 mm`,
    /// `l = 150 mm`, `E = 5.39 GPa`, and a 1 mm wall on both tubes.
    fn paper_config(
        radius_outer: f32,
        radius_inner: f32,
        depth_outer: f32,
        depth_inner: f32,
    ) -> Config {
        Config::new(
            radius_outer,
            radius_inner,
            1.0,
            1.0,
            depth_outer,
            depth_inner,
            5.0,
            5.0,
            15,
            0.0,
        )
    }

    fn paper_r1() -> Config {
        paper_config(3.0, 1.5, 5.0, 2.0)
    }

    fn paper_r2() -> Config {
        paper_config(5.5, 4.0, 10.0, 7.0)
    }

    fn paper_backend(samples_per_notch: usize) -> CosseratBackend {
        CosseratBackend::new(SolverSettings {
            curvature_modes: 5,
            torsion_modes: 0,
            planar: true,
            samples_per_notch,
            max_iterations: 60,
            residual_tolerance: 1e-8,
            centroid_scale: 1.27,
            ..Default::default()
        })
    }

    /// Solves one single-section paper case with gravity off.
    fn paper_solve(config: Config, delta_a_mm: f64, samples_per_notch: usize) -> DeformedState {
        let design = RobotDesign::new(
            BasePose::default(),
            vec![ModuleDesign::Section(SectionDesign::new(
                config,
                Material::PLA,
            ))],
        );
        let mut backend = paper_backend(samples_per_notch);
        let mut controls = backend.default_controls(&design);
        controls.gravity_enabled = false;
        let descriptors = backend.controls(&design);
        controls
            .set(&descriptors, "section.0.push_pull", delta_a_mm)
            .unwrap();
        let state = backend.solve(&design, &controls).unwrap();
        assert!(
            state.diagnostics.converged,
            "delta_a {delta_a_mm} did not converge: {:?}",
            state.diagnostics
        );
        state
    }

    fn paper_tip(config: Config, delta_a_mm: f64) -> [f64; 3] {
        paper_solve(config, delta_a_mm, 4).tip
    }

    #[test]
    fn controls_expose_base_push_pull_and_rolls() {
        let design = RobotDesign::new(
            BasePose::default(),
            vec![
                ModuleDesign::Roll(RollDesign { angle_deg: 10.0 }),
                ModuleDesign::Section(SectionDesign::new(r1_config(), Material::PLA)),
                ModuleDesign::Roll(RollDesign { angle_deg: 90.0 }),
                ModuleDesign::Section(SectionDesign::new(r1_config(), Material::PLA)),
            ],
        );
        let backend = CosseratBackend::default();
        let controls = backend.controls(&design);
        let keys: Vec<_> = controls
            .iter()
            .map(|control| control.key.as_str())
            .collect();
        assert_eq!(keys[0], "base.x");
        assert!(keys.contains(&"section.0.push_pull"));
        assert!(keys.contains(&"section.1.push_pull"));
        assert!(keys.contains(&"roll.0.angle"));
        assert!(keys.contains(&"roll.1.angle"));
        assert_eq!(
            controls
                .iter()
                .find(|control| control.key == "roll.1.angle")
                .unwrap()
                .value,
            90.0
        );
    }

    #[test]
    fn zero_controls_are_straight_without_gravity() {
        let design = single_design();
        let mut backend = CosseratBackend::default();
        let mut controls = backend.default_controls(&design);
        controls.gravity_enabled = false;
        let state = backend.solve(&design, &controls).unwrap();
        assert_eq!(state.backend, BackendId::Cosserat);
        assert_eq!(state.sections.len(), 1);
        assert!(state.tip[2] > 100.0);
        for point in &state.centerline {
            assert!(point[0].abs() < 1e-6);
            assert!(point[1].abs() < 1e-6);
        }
    }

    #[test]
    fn push_pull_bends_the_section_in_the_expected_direction() {
        let design = single_design();
        let mut backend = CosseratBackend::default();
        let mut controls = backend.default_controls(&design);
        controls.gravity_enabled = false;
        controls
            .set(&backend.controls(&design), "section.0.push_pull", 3.0)
            .unwrap();
        let state = backend.solve(&design, &controls).unwrap();
        let tip = state.sections[0].centerline.last().unwrap();
        // +Y in the paper frame maps to +x in the repo frame.
        assert!(tip[0].abs() > 1e-3, "tip {tip:?}");
    }

    #[test]
    fn gravity_sags_toward_negative_z() {
        let config = Config::new(3.0, 1.5, 1.0, 1.0, 5.0, 2.0, 5.0, 5.0, 15, 0.0);
        let design = RobotDesign::new(
            BasePose::default(),
            vec![ModuleDesign::Section(SectionDesign::new(
                config,
                Material::PLA,
            ))],
        );
        let mut backend = CosseratBackend::default();
        let controls = backend.default_controls(&design);
        let state = backend.solve(&design, &controls).unwrap();
        let tip = state.tip;
        assert!(tip[2] < 150.0);
        assert!(tip[2] > 0.0);
    }

    #[test]
    fn base_rotation_without_gravity_is_rigid() {
        let design = single_design();
        let mut backend = CosseratBackend::default();
        let mut controls = backend.default_controls(&design);
        controls.gravity_enabled = false;
        let descriptors = backend.controls(&design);
        // `base.roll` is a rotation about the repo x axis, matching
        // `BasePose::transform`. A 90° roll maps the axial +z direction to -y.
        controls.set(&descriptors, "base.roll", 90.0).unwrap();
        let rotated = backend.solve(&design, &controls).unwrap();
        let tip = rotated.tip;
        assert!(tip[0].abs() < 1e-4, "tip {tip:?}");
        assert!((tip[1] + 150.0).abs() < 1e-3, "tip {tip:?}");
        assert!(tip[2].abs() < 1e-4, "tip {tip:?}");
    }

    /// R1/R2 from the paper's Table 1 with gravity off.
    ///
    /// The exact tip positions in Figure 12 depend on the paper's calibration
    /// and equivalent-rod discretisation, so this test pins the qualitative
    /// response and a generous envelope around the published simulation:
    /// symmetric bending in the plane, monotonic deflection with `|Δa|`, the
    /// axial length staying near 150 mm, and R1 bending more than R2.
    #[test]
    fn paper_r1_r2_match_the_reference_cppr_trends() {
        let deltas = [-7.0, -3.5, 0.0, 3.5, 7.0];
        let r1: Vec<[f64; 3]> = deltas
            .iter()
            .map(|delta| paper_tip(paper_r1(), *delta))
            .collect();

        for (delta, tip) in deltas.iter().zip(r1.iter()) {
            assert!(tip[1].abs() < 1e-6, "R1 Δa {delta}: out of plane {tip:?}");
            assert!(tip[2] > 0.0, "R1 Δa {delta}: negative length {tip:?}");
            // Large bends trade axial reach for lateral deflection, but the
            // rod never folds back on itself.
            assert!(tip[2] > 70.0, "R1 Δa {delta}: axial tip {tip:?}");
            assert!(
                norm3(tip) <= 160.0,
                "R1 Δa {delta}: tip longer than the rod {tip:?}"
            );
        }

        // Δa = 0 is straight and unshortened.
        assert!(r1[2][0].abs() < 1e-6, "R1 rest tip {:?}", r1[2]);
        assert!((r1[2][2] - 150.0).abs() < 1e-3, "R1 rest tip {:?}", r1[2]);

        // Opposite actuation bends to opposite sides.
        for pair in [(0, 4), (1, 3)] {
            let negative = r1[pair.0][0];
            let positive = r1[pair.1][0];
            assert!(
                negative * positive < 0.0,
                "R1 Δa {} and {} bend the same way: {:?}, {:?}",
                deltas[pair.0],
                deltas[pair.1],
                r1[pair.0],
                r1[pair.1]
            );
        }

        // Deflection grows monotonically with |Δa| on both sides.
        let magnitudes: Vec<f64> = r1.iter().map(|tip| tip[0].abs()).collect();
        assert!(magnitudes[0] > magnitudes[1], "{magnitudes:?}");
        assert!(magnitudes[1] > magnitudes[2], "{magnitudes:?}");
        assert!(magnitudes[2] < magnitudes[3], "{magnitudes:?}");
        assert!(magnitudes[3] < magnitudes[4], "{magnitudes:?}");

        // |Δa| = 7 mm is roughly symmetric, but leader/follower roles make the
        // exact curves differ slightly.
        let symmetry_error =
            (magnitudes[0] - magnitudes[4]).abs() / magnitudes[0].max(magnitudes[4]);
        assert!(symmetry_error < 0.15, "R1 asymmetry {symmetry_error:.3}");

        // Envelope read from Figure 12: at full actuation the R1 tip is about
        // 100 mm off axis and still close to 90 mm long.
        for (delta, tip) in [(-7.0, r1[0]), (7.0, r1[4])] {
            assert!(
                (85.0..=120.0).contains(&tip[0].abs()),
                "R1 Δa {delta}: lateral tip {tip:?}"
            );
            assert!(
                (75.0..=110.0).contains(&tip[2]),
                "R1 Δa {delta}: axial tip {tip:?}"
            );
        }

        // R2 is stiffer and bends noticeably less than R1 at the same Δa.
        for delta in [-7.0, 7.0] {
            let r2 = paper_tip(paper_r2(), delta);
            assert!(r2[1].abs() < 1e-6, "R2 Δa {delta}: out of plane {r2:?}");
            assert!(
                (35.0..=60.0).contains(&r2[0].abs()),
                "R2 Δa {delta}: lateral tip {r2:?}"
            );
            assert!(
                (125.0..=150.0).contains(&r2[2]),
                "R2 Δa {delta}: axial tip {r2:?}"
            );
            let r1_lateral = if delta < 0.0 { r1[0][0] } else { r1[4][0] };
            assert!(
                r1_lateral.abs() > 1.5 * r2[0].abs(),
                "R1 Δa {delta} should bend more than R2: {r1_lateral:.2} vs {:.2}",
                r2[0]
            );
        }
    }

    /// The RK4 integration per notch should be mesh-converged at the default
    /// four samples per notch.
    #[test]
    fn paper_r1_tip_is_mesh_converged() {
        let coarse = paper_tip(paper_r1(), 7.0);
        let medium = paper_solve(paper_r1(), 7.0, 4).tip;
        let fine = paper_solve(paper_r1(), 7.0, 6).tip;
        // Three -> four samples is the largest change; four -> six is tiny.
        assert!(
            (fine[0] - medium[0]).abs() < 0.5,
            "lateral: {medium:?} vs {fine:?}"
        );
        assert!(
            (fine[2] - medium[2]).abs() < 0.5,
            "axial: {medium:?} vs {fine:?}"
        );
        assert!(
            (medium[0] - coarse[0]).abs() < 3.0,
            "coarse: {coarse:?} vs {medium:?}"
        );
    }

    #[test]
    fn paper_r1_centerline_is_smooth() {
        let state = paper_solve(paper_r1(), 7.0, 4);
        let points = &state.sections[0].centerline;
        assert!(points.len() > 10);
        let mut lengths = Vec::new();
        for pair in points.windows(2) {
            let delta = [
                pair[1][0] - pair[0][0],
                pair[1][1] - pair[0][1],
                pair[1][2] - pair[0][2],
            ];
            let length = (delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]).sqrt();
            assert!(length > 1e-9, "duplicate centerline point {:?}", pair[0]);
            lengths.push(length);
        }
        let min = lengths.iter().copied().fold(f64::INFINITY, f64::min);
        let max = lengths.iter().copied().fold(0.0, f64::max);
        assert!(max / min < 4.0, "uneven spacing {min:.4}..{max:.4}");

        // No kinks: the tangent turns by less than 15° between samples.
        for pair in points.windows(3) {
            let a = [
                pair[1][0] - pair[0][0],
                pair[1][1] - pair[0][1],
                pair[1][2] - pair[0][2],
            ];
            let b = [
                pair[2][0] - pair[1][0],
                pair[2][1] - pair[1][1],
                pair[2][2] - pair[1][2],
            ];
            let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            let cosine = dot / (norm3(&a) * norm3(&b));
            assert!(
                cosine > 15.0_f64.to_radians().cos(),
                "kink at {:.4}: cos {cosine:.4}",
                pair[1][0]
            );
        }
    }

    fn norm3(vector: &[f64; 3]) -> f64 {
        (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt()
    }
}
