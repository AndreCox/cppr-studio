//! Single-section 3D Cosserat solver.
//!
//! The solver implements the paper's two-pass computed-torque algorithm for a
//! two-tube CPPR and returns both the generalized residual and the reconstructed
//! frame fields. The chain layer in [`super::chain`] reuses it section by
//! section and transfers wrenches through rigid connectors.
//!
//! Internal coordinates are metres and radians. The public backend converts
//! millimetres/degrees at its boundary.

use nalgebra::{DMatrix, DVector, Vector3, Vector6};

use super::cross_section::{CrossSection, SectionTubes};
use super::kinematics::{
    Pose, RitzBasis, ad_mul, ad_transpose_mul, hat_angular, point_paper_to_repo,
    pose_paper_to_repo, relative_pose, relative_pose_from_sin_cos,
};

const EPS: f64 = 1e-12;
const MAX_SAMPLES: usize = 4001;

/// Numeric settings shared by every section in a chain.
#[derive(Debug, Clone, PartialEq)]
pub struct SolverSettings {
    /// Ritz modes per curvature component in 3D, or total modes in planar mode.
    pub curvature_modes: usize,
    /// Torsion modes per follower.
    pub torsion_modes: usize,
    /// Expand only `K1Z`, matching the paper's 2D validation.
    pub planar: bool,
    /// Integration samples per notch (the total is rounded up and made odd).
    pub samples_per_notch: usize,
    pub max_iterations: usize,
    pub residual_tolerance: f64,
    pub finite_difference_step: f64,
    pub lm_initial_damping: f64,
    /// Initial Levenberg-Marquardt damping for the assembled chain solve.
    ///
    /// The chain scales its damping by the diagonal of `J^T J`, so the same
    /// numeric value means very different step sizes than in the single-section
    /// solver. A smaller value reaches the quadratic-convergence regime much
    /// sooner.
    pub chain_lm_initial_damping: f64,
    /// Update the chain Jacobian with Broyden rank-one steps between full
    /// finite-difference rebuilds. A full rebuild costs one chain evaluation
    /// per unknown, so this is the difference between `O(n)` and `O(1)`
    /// evaluations per iteration.
    pub chain_broyden: bool,
    /// Rebuild the finite-difference Jacobian at least this often, even when
    /// Broyden updates are enabled.
    pub chain_jacobian_refresh: usize,
    /// Largest push/pull target change (metres) that is expected to warm-start
    /// well. Larger changes go straight to the continuation ramp.
    pub chain_warm_target_change_m: f64,
    pub displacement_tolerance_m: f64,
    /// Scales the kinematic centroid offsets `D` only, as the paper's `fD`
    /// calibration factor. Cross-section inertias keep the uncalibrated value.
    pub centroid_scale: f64,
    /// Use the paper's printed shear modulus `E (1 + nu) / 2` instead of the
    /// isotropic `E / (2 (1 + nu))`.
    pub paper_parity_shear: bool,
}

impl Default for SolverSettings {
    fn default() -> Self {
        Self {
            curvature_modes: 3,
            torsion_modes: 2,
            planar: false,
            samples_per_notch: 8,
            max_iterations: 80,
            residual_tolerance: 1e-8,
            finite_difference_step: 1e-6,
            lm_initial_damping: 1e-3,
            chain_lm_initial_damping: 1e-7,
            chain_broyden: true,
            chain_jacobian_refresh: 16,
            chain_warm_target_change_m: 0.3e-3,
            displacement_tolerance_m: 1e-7,
            centroid_scale: 1.0,
            paper_parity_shear: false,
        }
    }
}

/// One integration node, including the reconstructed pose and twist fields.
#[derive(Debug, Clone)]
pub struct NodeState {
    pub s: f64,
    pub g1: Pose,
    pub gk: Pose,
    pub xk: f64,
    pub xi1: Vector6<f64>,
    pub xik: Vector6<f64>,
    pub h: f64,
    pub theta: f64,
    pub dtheta_ds: f64,
    pub d1: f64,
    pub d1_prime: f64,
    pub dk: f64,
    pub dk_prime: f64,
    pub cs1: CrossSection,
    pub csk: CrossSection,
    pub h1: [f64; 6],
    pub hk: [f64; 6],
    pub xi1_rest: Vector6<f64>,
    pub xik_rest: Vector6<f64>,
}

impl NodeState {
    /// Shared CPPR centerline point `C` in the paper's frame, metres.
    pub fn centerline_paper(&self) -> Vector3<f64> {
        self.g1.translation - self.d1 * (self.g1.rotation * Vector3::y())
    }
}

/// The solved fields for one section.
#[derive(Debug, Clone)]
pub struct SectionEvaluation {
    pub q: Vec<f64>,
    pub t_plus_n: f64,
    /// `Delta a = L - X~2(0)`, metres.
    pub delta_a_m: f64,
    /// Generalized residual `Qint + Qext`.
    pub residual: Vec<f64>,
    pub nodes: Vec<NodeState>,
    pub leader_tip: Pose,
    pub follower_tip: Pose,
    /// External leader stress at the base, in the leader base frame.
    pub base_reaction: Vector6<f64>,
    pub converged: bool,
    pub iterations: usize,
    pub residual_norm: f64,
}

impl SectionEvaluation {
    /// Shared centerline in the paper frame, metres.
    pub fn centerline_paper(&self) -> Vec<Vector3<f64>> {
        self.nodes.iter().map(NodeState::centerline_paper).collect()
    }

    /// Shared centerline in repo coordinates, millimetres.
    pub fn centerline_repo_mm(&self) -> Vec<[f64; 3]> {
        self.centerline_paper()
            .into_iter()
            .map(|point| {
                let point = point_paper_to_repo(&point) * 1e3;
                [point[0], point[1], point[2]]
            })
            .collect()
    }

    /// Leader centroid frames in repo coordinates, millimetres, with the
    /// signed centroid-to-centerline offset along the local `+x` axis.
    pub fn leader_frames_repo_mm(&self) -> Vec<(f64, Pose, f64)> {
        self.nodes
            .iter()
            .map(|node| {
                let mut pose = pose_paper_to_repo(&node.g1);
                pose.translation *= 1e3;
                (node.s * 1e3, pose, node.d1 * 1e3)
            })
            .collect()
    }

    /// Follower centroid frames in repo coordinates, millimetres, with the
    /// signed centroid-to-centerline offset along the local `+x` axis.
    pub fn follower_frames_repo_mm(&self) -> Vec<(f64, Pose, f64)> {
        self.nodes
            .iter()
            .map(|node| {
                let mut pose = pose_paper_to_repo(&node.gk);
                pose.translation *= 1e3;
                (node.s * 1e3, pose, node.dk * 1e3)
            })
            .collect()
    }
}

/// Geometry and basis values at one integration sample.
///
/// Everything here depends only on the section geometry and the fixed
/// integration grid, never on the Ritz coefficients. Precomputing it removes
/// thousands of cross-section and Legendre evaluations from every solve.
#[derive(Debug, Clone)]
struct LeaderSample {
    cs: CrossSection,
    d1: f64,
    d1_prime: f64,
    h1: [f64; 6],
    curvature_values: Vec<f64>,
    torsion_values: Vec<f64>,
    torsion_derivatives: Vec<f64>,
}

/// The two-pass solver for one section.
#[derive(Debug, Clone)]
pub struct SectionSolver {
    pub tubes: SectionTubes,
    pub basis: RitzBasis,
    pub settings: SolverSettings,
    pub s_nodes: Vec<f64>,
    /// Leader geometry and Ritz basis at every node and midpoint.
    leader_samples: Vec<LeaderSample>,
}

impl SectionSolver {
    pub fn new(mut tubes: SectionTubes, settings: SolverSettings) -> Self {
        if settings.paper_parity_shear {
            let leader = &mut tubes.leader;
            let e = leader.material.youngs_modulus_pa;
            let nu = leader.material.poisson_ratio;
            leader.shear_modulus_override_pa = Some(e * (1.0 + nu) / 2.0);
            let follower = &mut tubes.follower;
            let e = follower.material.youngs_modulus_pa;
            let nu = follower.material.poisson_ratio;
            follower.shear_modulus_override_pa = Some(e * (1.0 + nu) / 2.0);
        }

        let samples = (settings.samples_per_notch.max(1) * tubes.segment_count + 1).max(17);
        let mut samples = samples.min(MAX_SAMPLES);
        if samples.is_multiple_of(2) {
            samples += 1;
        }
        let samples = samples.min(MAX_SAMPLES);
        let length = tubes.length_m.max(1e-9);
        let s_nodes = (0..samples)
            .map(|index| index as f64 * length / (samples - 1) as f64)
            .collect();

        let basis = RitzBasis {
            length_m: length,
            curvature_modes: settings.curvature_modes.max(1),
            // The paper's 2D model has no follower torsion. Keep zero modes
            // possible there while 3D always carries at least one.
            torsion_modes: if settings.planar {
                settings.torsion_modes
            } else {
                settings.torsion_modes.max(1)
            },
            planar: settings.planar,
        };

        let step = length / (samples - 1) as f64;
        let sample_count = 2 * samples - 1;
        let s_samples: Vec<f64> = (0..sample_count)
            .map(|index| 0.5 * index as f64 * step)
            .collect();
        let centroid_scale = settings.centroid_scale;
        let leader_samples: Vec<LeaderSample> = s_samples
            .iter()
            .map(|&s| {
                let (curvature_values, _) = basis.curvature(s);
                let (torsion_values, torsion_derivatives) = basis.torsion(s);
                let cs = tubes.leader.section_at(s);
                LeaderSample {
                    cs,
                    d1: cs.centroid_offset_m * centroid_scale,
                    d1_prime: tubes.leader.centroid_offset_derivative(s) * centroid_scale,
                    h1: tubes.leader.hooke_diagonal(s),
                    curvature_values,
                    torsion_values,
                    torsion_derivatives,
                }
            })
            .collect();

        Self {
            tubes,
            basis,
            settings,
            s_nodes,
            leader_samples,
        }
    }

    pub fn length_m(&self) -> f64 {
        self.tubes.length_m
    }

    /// Kinematic centroid offset `(D, dD/ds)` at leader label `s`, including
    /// the optional calibration scale. Lengths are metres.
    pub fn leader_offset_at(&self, s: f64) -> (f64, f64) {
        (
            self.tubes.leader.section_at(s).centroid_offset_m * self.settings.centroid_scale,
            self.tubes.leader.centroid_offset_derivative(s) * self.settings.centroid_scale,
        )
    }

    pub fn coefficient_count(&self) -> usize {
        self.basis.curvature_coefficients() + self.basis.torsion_modes
    }

    pub fn zero_coefficients(&self) -> Vec<f64> {
        vec![0.0; self.coefficient_count()]
    }

    pub fn curvature_slice(&self) -> std::ops::Range<usize> {
        0..self.basis.curvature_coefficients()
    }

    pub fn torsion_slice(&self) -> std::ops::Range<usize> {
        self.basis.curvature_coefficients()..self.coefficient_count()
    }

    /// Evaluates the full section at `q`, `T+`, and an external tip wrench.
    pub fn evaluate(
        &self,
        base_pose: &Pose,
        q: &[f64],
        t_plus_n: f64,
        tip_wrench_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> SectionEvaluation {
        let nodes = self.forward_pass(base_pose, q);
        let (lambda1, lambdak) =
            self.stress_pass(&nodes, t_plus_n, tip_wrench_world, gravity_world);
        let (q_int, q_ext) = self.project_pair(&nodes, &lambda1, &lambdak);
        let residual: Vec<f64> = q_int
            .iter()
            .zip(&q_ext)
            .map(|(internal, external)| internal + external)
            .collect();
        let residual_norm = residual
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt();
        let delta_a_m = self.tubes.length_m - nodes[0].xk;
        let base_reaction = lambda1[0];
        let leader_tip = nodes[nodes.len() - 1].g1;
        let follower_tip = nodes[nodes.len() - 1].gk;

        SectionEvaluation {
            q: q.to_vec(),
            t_plus_n,
            delta_a_m,
            residual,
            nodes,
            leader_tip,
            follower_tip,
            base_reaction,
            converged: false,
            iterations: 0,
            residual_norm,
        }
    }

    /// Forward pass: leader pose from base to tip, follower backward to the
    /// baseplate opening. Returns the node fields.
    pub fn forward_pass(&self, base_pose: &Pose, q: &[f64]) -> Vec<NodeState> {
        let count = self.s_nodes.len();
        let mut nodes: Vec<NodeState> = (0..count)
            .map(|index| self.empty_node(self.s_nodes[index]))
            .collect();

        // Leader: right-invariant ODE, so the RK4 stages only need `s`.
        nodes[0].g1 = *base_pose;
        for index in 0..count - 1 {
            let step = self.s_nodes[index + 1] - self.s_nodes[index];

            let xi0 = self.leader_twist_sample(&self.leader_samples[2 * index], q);
            let xi_mid = self.leader_twist_sample(&self.leader_samples[2 * index + 1], q);
            let xi1 = self.leader_twist_sample(&self.leader_samples[2 * index + 2], q);
            let integrated = (xi0 + 4.0 * xi_mid + xi1) * (step / 6.0);
            nodes[index + 1].g1 = nodes[index].g1.compose(&Pose::exp(&integrated, 1.0));
        }

        // Fill leader fields at every node.
        for (index, node) in nodes.iter_mut().enumerate() {
            let sample = &self.leader_samples[2 * index];
            node.xi1 = self.leader_twist_sample(sample, q);
            node.d1 = sample.d1;
            node.d1_prime = sample.d1_prime;
            node.cs1 = sample.cs;
            node.xi1_rest = Vector6::new(0.0, 0.0, 0.0, 1.0, sample.d1_prime, 0.0);
            node.h1 = sample.h1;
        }

        // Follower: integrate backwards from the distal platform.
        let tip = count - 1;
        let theta_tip = self.torsion_angle_sample(&self.leader_samples[2 * tip], q);
        let d1_tip = nodes[tip].d1;
        let dk_tip =
            self.tubes.follower.section_at(0.0).centroid_offset_m * self.settings.centroid_scale;
        let rel_tip = relative_pose(theta_tip, d1_tip, dk_tip);
        nodes[tip].xk = 0.0;
        nodes[tip].gk = nodes[tip].g1.compose(&rel_tip);

        for index in (0..count - 1).rev() {
            let ds = self.s_nodes[index] - self.s_nodes[index + 1]; // negative
            let xk0 = nodes[index + 1].xk;

            let (h0, xi0) = self.follower_rhs_sample(&self.leader_samples[2 * index + 2], xk0, q);
            let (h1, xi1) = self.follower_rhs_sample(
                &self.leader_samples[2 * index + 1],
                xk0 + 0.5 * ds * h0,
                q,
            );
            let (h2, xi2) = self.follower_rhs_sample(
                &self.leader_samples[2 * index + 1],
                xk0 + 0.5 * ds * h1,
                q,
            );
            let (h3, xi3) =
                self.follower_rhs_sample(&self.leader_samples[2 * index], xk0 + ds * h2, q);

            let xk_new = xk0 + ds / 6.0 * (h0 + 2.0 * h1 + 2.0 * h2 + h3);
            let eta0 = h0 * xi0;
            let eta1 = h1 * xi1;
            let eta2 = h2 * xi2;
            let eta3 = h3 * xi3;
            let integrated = (eta0 + 2.0 * eta1 + 2.0 * eta2 + eta3) * (ds / 6.0);
            nodes[index].xk = xk_new;
            nodes[index].gk = nodes[index + 1].gk.compose(&Pose::exp(&integrated, 1.0));
        }

        // Fill follower fields, including the rest twist at the rest label.
        for (index, node) in nodes.iter_mut().enumerate() {
            let s = self.s_nodes[index];
            let sample = &self.leader_samples[2 * index];
            let xk = node.xk;
            let (h, xik) = self.follower_rhs_sample(sample, xk, q);
            let theta = self.torsion_angle_sample(sample, q);
            let (dtheta, _) = self.torsion_value_sample(sample, q);
            let cs = self.tubes.follower.section_at(xk);
            let dk = cs.centroid_offset_m * self.settings.centroid_scale;
            let dk_prime =
                self.tubes.follower.centroid_offset_derivative(xk) * self.settings.centroid_scale;
            let d1_prime = node.d1_prime;

            let xk_rest = (self.tubes.length_m - s).clamp(0.0, self.tubes.length_m);
            let cs_rest = self.tubes.follower.section_at(xk_rest);
            let dk_rest = cs_rest.centroid_offset_m * self.settings.centroid_scale;
            let dk_rest_prime = self.tubes.follower.centroid_offset_derivative(xk_rest)
                * self.settings.centroid_scale;
            let rel_rest = relative_pose(0.0, node.d1, dk_rest);
            let eta_rest = rel_rest.inverse().adjoint() * node.xi1_rest;
            let mu_rest = Vector6::new(0.0, 0.0, 0.0, 0.0, d1_prime - dk_rest_prime, 0.0);

            node.xik = xik;
            node.h = h;
            node.theta = theta;
            node.dtheta_ds = dtheta;
            node.dk = dk;
            node.dk_prime = dk_prime;
            node.csk = cs;
            node.hk = self.tubes.follower.hooke_diagonal(xk);
            node.xik_rest = -(eta_rest + mu_rest);
        }

        nodes
    }

    fn empty_node(&self, s: f64) -> NodeState {
        let cs = CrossSection::notched(0.0, 0.0, 0.0);
        NodeState {
            s,
            g1: Pose::identity(),
            gk: Pose::identity(),
            xk: 0.0,
            xi1: Vector6::zeros(),
            xik: Vector6::zeros(),
            h: -1.0,
            theta: 0.0,
            dtheta_ds: 0.0,
            d1: 0.0,
            d1_prime: 0.0,
            dk: 0.0,
            dk_prime: 0.0,
            cs1: cs,
            csk: cs,
            h1: [0.0; 6],
            hk: [0.0; 6],
            xi1_rest: Vector6::new(0.0, 0.0, 0.0, 1.0, 0.0, 0.0),
            xik_rest: Vector6::zeros(),
        }
    }

    fn leader_twist_sample(&self, sample: &LeaderSample, q: &[f64]) -> Vector6<f64> {
        let curvature = self
            .basis
            .curvature_vector_from_values(&sample.curvature_values, &q[self.curvature_slice()]);
        Vector6::new(
            curvature[0],
            curvature[1],
            curvature[2],
            1.0,
            sample.d1_prime,
            sample.d1 * curvature[0],
        )
    }

    fn torsion_angle_sample(&self, sample: &LeaderSample, q: &[f64]) -> f64 {
        let torsion = &q[self.torsion_slice()];
        sample
            .torsion_values
            .iter()
            .zip(torsion)
            .map(|(value, coefficient)| value * coefficient)
            .sum()
    }

    fn torsion_value_sample(&self, sample: &LeaderSample, q: &[f64]) -> (f64, f64) {
        self.basis.torsion_value_from_values(
            &sample.torsion_values,
            &sample.torsion_derivatives,
            &q[self.torsion_slice()],
        )
    }

    /// Returns `(h, xi_k)` for the follower at leader label `s` and follower
    /// label `xk`.
    fn follower_rhs_sample(
        &self,
        sample: &LeaderSample,
        xk: f64,
        q: &[f64],
    ) -> (f64, Vector6<f64>) {
        let xi1 = self.leader_twist_sample(sample, q);
        let d1 = sample.d1;
        let d1_prime = sample.d1_prime;
        let cs = self.tubes.follower.section_at(xk);
        let dk = cs.centroid_offset_m * self.settings.centroid_scale;
        let dk_prime =
            self.tubes.follower.centroid_offset_derivative(xk) * self.settings.centroid_scale;
        let theta = self.torsion_angle_sample(sample, q);
        let (_, dtheta_ds) = self.torsion_value_sample(sample, q);
        let (sk, ck) = theta.sin_cos();

        let mut h = -(1.0 + d1 * xi1[2] + dk * (ck * xi1[2] + sk * xi1[1]));
        if h.abs() < 1e-6 {
            h = -1e-6;
        }

        let dtheta_relabeled = dtheta_ds / h;
        let nu = Vector6::new(-1.0, 0.0, 0.0, 0.0, 0.0, -dk);
        let mu = Vector6::new(0.0, 0.0, 0.0, 0.0, ck * d1_prime - dk_prime, -sk * d1_prime);
        let rel = relative_pose_from_sin_cos(sk, ck, d1, dk);
        let eta = rel.inverse().adjoint() * xi1;
        let xi_k = (eta + nu * dtheta_relabeled + mu) / h;
        (h, xi_k)
    }

    /// Backward statics pass. Returns `(lambda1, lambda_k)` at every node.
    fn stress_pass(
        &self,
        nodes: &[NodeState],
        t_plus_n: f64,
        tip_wrench_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> (Vec<Vector6<f64>>, Vec<Vector6<f64>>) {
        let count = nodes.len();
        let mut lambdak = vec![Vector6::zeros(); count];
        let mut lambda1 = vec![Vector6::zeros(); count];

        // Follower: baseplate opening -> distal tip.
        lambdak[0] = Vector6::new(0.0, 0.0, 0.0, t_plus_n, 0.0, 0.0);
        for index in 0..count - 1 {
            let step = self.s_nodes[index + 1] - self.s_nodes[index];
            let f = |s: f64, lambda: &Vector6<f64>| {
                let (h, xik, orientation, mass) = self.follower_stage(s, nodes);
                h * ad_transpose_mul(&xik, lambda)
                    - h * body_gravity_wrench(&orientation, mass, gravity_world)
            };
            lambdak[index + 1] = rk4_step(&f, self.s_nodes[index], lambdak[index], step);
        }

        // Transfer follower tip wrench to the leader tip, add the external load.
        //
        // `tip_wrench_world` is a wrench at the leader's centroid tip point,
        // with its moment and force expressed in world orientation. The paper
        // uses `g_{1,s}`: the tip frame in an inertial basis *located at the
        // force application point*, so only the rotation acts here. Applying
        // the full adjoint would add the spurious moment arm from the world
        // origin to the tip.
        let tip = count - 1;
        let rel_tip = relative_pose(nodes[tip].theta, nodes[tip].d1, nodes[tip].dk);
        let follower_tip_in_leader = rel_tip.wrench_from_child(&lambdak[tip]);
        let tip_rotation = Pose::new(nodes[tip].g1.rotation, Vector3::zeros());
        let external_tip = tip_rotation.wrench_from_child(tip_wrench_world);
        lambda1[tip] = follower_tip_in_leader + external_tip;

        // Leader: distal tip -> base.
        for index in (0..count - 1).rev() {
            let step = self.s_nodes[index] - self.s_nodes[index + 1];
            let f = |s: f64, lambda: &Vector6<f64>| {
                let xi1 = self.leader_field_at(s, nodes, |node| node.xi1);
                let orientation = self.leader_pose_at(s, nodes);
                let mass = self.tubes.leader.mass_per_length(s);
                ad_transpose_mul(&xi1, lambda)
                    - body_gravity_wrench(&orientation, mass, gravity_world)
            };
            lambda1[index] = rk4_step(&f, self.s_nodes[index + 1], lambda1[index + 1], step);
        }

        (lambda1, lambdak)
    }

    fn follower_stage(&self, s: f64, nodes: &[NodeState]) -> (f64, Vector6<f64>, Pose, f64) {
        let (index, fraction) = self.interval(s);
        let low = &nodes[index];
        let high = &nodes[index + 1];
        let h = lerp(low.h, high.h, fraction);
        let xik = lerp_vector6(&low.xik, &high.xik, fraction);
        let xk = lerp(low.xk, high.xk, fraction);
        let orientation = if fraction < 0.5 { low.gk } else { high.gk };
        (h, xik, orientation, self.tubes.follower.mass_per_length(xk))
    }

    fn leader_field_at(
        &self,
        s: f64,
        nodes: &[NodeState],
        select: impl Fn(&NodeState) -> Vector6<f64>,
    ) -> Vector6<f64> {
        let (index, fraction) = self.interval(s);
        lerp_vector6(&select(&nodes[index]), &select(&nodes[index + 1]), fraction)
    }

    fn leader_pose_at(&self, s: f64, nodes: &[NodeState]) -> Pose {
        let (index, fraction) = self.interval(s);
        if fraction < 0.5 {
            nodes[index].g1
        } else {
            nodes[index + 1].g1
        }
    }

    fn interval(&self, s: f64) -> (usize, f64) {
        let last = self.s_nodes.len() - 1;
        if s <= self.s_nodes[0] {
            return (0, 0.0);
        }
        if s >= self.s_nodes[last] {
            return (last - 1, 1.0);
        }
        let index = self
            .s_nodes
            .partition_point(|sample| *sample <= s)
            .saturating_sub(1)
            .min(last - 1);
        let span = self.s_nodes[index + 1] - self.s_nodes[index];
        let fraction = if span.abs() < EPS {
            0.0
        } else {
            (s - self.s_nodes[index]) / span
        };
        (index, fraction.clamp(0.0, 1.0))
    }

    /// Projects the internal and external stress fields onto the Ritz basis,
    /// Eq. (90)-(91).
    ///
    /// Both projections share all the per-node geometry (relative pose,
    /// adjoint, basis values), so evaluating them together costs barely more
    /// than one projection on its own.
    fn project_pair(
        &self,
        nodes: &[NodeState],
        lambda1: &[Vector6<f64>],
        lambdak: &[Vector6<f64>],
    ) -> (Vec<f64>, Vec<f64>) {
        let count = nodes.len();
        let weights = simpson_weights(count, self.tubes.length_m);
        let curvature_count = self.basis.curvature_coefficients();
        let torsion_count = self.basis.torsion_modes;
        let mut q_internal = vec![0.0; curvature_count + torsion_count];
        let mut q_external = vec![0.0; curvature_count + torsion_count];

        for index in 0..count {
            let node = &nodes[index];
            let weight = weights[index];
            let d1 = node.d1;
            let (sk, ck) = node.theta.sin_cos();

            let rel = relative_pose_from_sin_cos(sk, ck, node.d1, node.dk);
            let gk1 = rel.inverse();
            let adjoint = gk1.adjoint();
            let adjoint_transpose = adjoint.transpose();
            let eta = adjoint * node.xi1;
            let nu = Vector6::new(-1.0, 0.0, 0.0, 0.0, 0.0, -node.dk);
            let ad_eta_nu = ad_mul(&eta, &nu);
            let dh_dxi = Vector6::new(0.0, -node.dk * sk, -(node.d1 + node.dk * ck), 0.0, 0.0, 0.0);
            let dmu_dtheta =
                Vector6::new(0.0, 0.0, 0.0, 0.0, -sk * node.d1_prime, -ck * node.d1_prime);
            let dh_dtheta = node.dk * (sk * node.xi1[2] - ck * node.xi1[1]);

            let sample = &self.leader_samples[2 * index];
            let phi = &sample.curvature_values;
            let phi_theta = &sample.torsion_values;
            let dphi_theta = &sample.torsion_derivatives;

            let internal1 = -apply_hooke(&node.h1, &(node.xi1 - node.xi1_rest));
            let internalk = -apply_hooke(&node.hk, &(node.xik - node.xik_rest));

            for (bracket_field, wrench_field, out) in [
                (&internal1, &internalk, &mut q_internal),
                (&lambda1[index], &lambdak[index], &mut q_external),
            ] {
                let xi_dot_lambda = node.xik.dot(wrench_field);
                let mut bracket = *bracket_field;
                bracket -= adjoint_transpose * wrench_field - dh_dxi * xi_dot_lambda;

                let b_bracket = Vector3::new(bracket[0] + d1 * bracket[5], bracket[1], bracket[2]);
                if self.basis.planar {
                    for mode in 0..self.basis.curvature_modes {
                        out[mode] += weight * phi[mode] * b_bracket[2];
                    }
                } else {
                    for component in 0..3 {
                        for mode in 0..self.basis.curvature_modes {
                            out[component * self.basis.curvature_modes + mode] +=
                                weight * phi[mode] * b_bracket[component];
                        }
                    }
                }

                let first = nu.dot(wrench_field);
                let scalar = dmu_dtheta.dot(wrench_field) + ad_eta_nu.dot(wrench_field)
                    - dh_dtheta * xi_dot_lambda;
                for mode in 0..torsion_count {
                    out[curvature_count + mode] +=
                        weight * (-dphi_theta[mode] * first - phi_theta[mode] * scalar);
                }
            }
        }

        (q_internal, q_external)
    }

    /// Solves for `q` at a prescribed push/pull force `T+`.
    pub fn solve_force(
        &self,
        base_pose: &Pose,
        q0: &[f64],
        t_plus_n: f64,
        tip_wrench_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> SectionEvaluation {
        let mut q = if q0.len() == self.coefficient_count() {
            q0.to_vec()
        } else {
            self.zero_coefficients()
        };
        let mut evaluation =
            self.evaluate(base_pose, &q, t_plus_n, tip_wrench_world, gravity_world);
        let mut best = evaluation.clone();
        let mut damping = self.settings.lm_initial_damping.max(1e-12);
        let n = q.len();
        let mut iterations = 0;

        for iteration in 0..self.settings.max_iterations {
            iterations = iteration + 1;
            if evaluation.residual_norm <= self.settings.residual_tolerance {
                break;
            }

            let mut jacobian = DMatrix::zeros(n, n);
            let base_residual = DVector::from_column_slice(&evaluation.residual);
            for column in 0..n {
                let step =
                    self.settings.finite_difference_step.max(1e-12) * (1.0 + q[column].abs());
                let mut perturbed = q.clone();
                perturbed[column] += step;
                let plus = self.evaluate(
                    base_pose,
                    &perturbed,
                    t_plus_n,
                    tip_wrench_world,
                    gravity_world,
                );
                let difference = DVector::from_column_slice(&plus.residual) - &base_residual;
                for row in 0..n {
                    jacobian[(row, column)] = difference[row] / step;
                }
            }

            let mut accepted = false;
            for _ in 0..12 {
                let normal = jacobian.transpose() * &jacobian + DMatrix::identity(n, n) * damping;
                let gradient = jacobian.transpose() * &base_residual;
                let Some(step) = normal.lu().solve(&(-gradient)) else {
                    damping *= 10.0;
                    continue;
                };
                let candidate: Vec<f64> = q
                    .iter()
                    .zip(step.iter())
                    .map(|(value, delta)| value + delta)
                    .collect();
                let candidate_eval = self.evaluate(
                    base_pose,
                    &candidate,
                    t_plus_n,
                    tip_wrench_world,
                    gravity_world,
                );
                if candidate_eval.residual_norm < evaluation.residual_norm {
                    let improvement = evaluation.residual_norm - candidate_eval.residual_norm;
                    q = candidate;
                    evaluation = candidate_eval;
                    damping = (damping * 0.3).max(1e-12);
                    accepted = true;
                    if improvement < 1e-14 {
                        break;
                    }
                    break;
                }
                damping = (damping * 10.0).min(1e12);
            }

            if evaluation.residual_norm < best.residual_norm {
                best = evaluation.clone();
            }
            if !accepted {
                break;
            }
        }

        if evaluation.residual_norm <= best.residual_norm {
            best = evaluation;
        }
        best.converged = best.residual_norm <= self.settings.residual_tolerance.max(1e-10);
        best.iterations = iterations;
        best
    }

    /// Solves displacement control by finding the `T+` that makes
    /// `Delta a` match `delta_a_target_m`.
    pub fn solve_displacement(
        &self,
        base_pose: &Pose,
        q0: &[f64],
        delta_a_target_m: f64,
        tip_wrench_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> SectionEvaluation {
        let target = delta_a_target_m;
        let tolerance = self.settings.displacement_tolerance_m.max(1e-9);
        let mut warm = if q0.len() == self.coefficient_count() {
            q0.to_vec()
        } else {
            self.zero_coefficients()
        };

        let eval_at = |force: f64, warm: &[f64]| {
            self.solve_force(base_pose, warm, force, tip_wrench_world, gravity_world)
        };

        let at_zero = eval_at(0.0, &warm);
        if (at_zero.delta_a_m - target).abs() <= tolerance {
            return at_zero;
        }
        warm = at_zero.q.clone();

        // Seed the scalar secant with a one-newton probe. The load-displacement
        // curve is nearly linear for small `T+`, so a secant through the origin
        // usually brackets the target in one step instead of a long geometric
        // search.
        let sign = if target >= 0.0 { 1.0 } else { -1.0 };
        let probe = eval_at(sign, &warm);
        let guess = if probe.delta_a_m * target > 0.0 && probe.delta_a_m.abs() > 1e-12 {
            (target.abs() / probe.delta_a_m.abs()).clamp(0.05, 1e4)
        } else {
            0.05
        };

        let mut low = 0.0;
        let mut low_eval = at_zero;
        let mut high = sign * guess;
        let mut high_eval = eval_at(high, &warm);

        let mut bracketed = false;
        for _ in 0..16 {
            let f_low = low_eval.delta_a_m - target;
            let f_high = high_eval.delta_a_m - target;
            if f_low.signum() != f_high.signum() || f_high.abs() <= tolerance {
                bracketed = true;
                break;
            }

            // Extrapolate along the secant through `(low, high)` instead of
            // doubling. The load-displacement curve is smooth, so this lands
            // close to the bracket even when the probe undershoots.
            let denominator = f_high - f_low;
            let mut next = if denominator.abs() > EPS {
                high - f_high * (high - low) / denominator
            } else {
                high * 2.0
            };
            if next.abs() <= high.abs() * (1.0 + 1e-12) {
                next = high * 2.0;
            }
            low = high;
            low_eval = std::mem::replace(&mut high_eval, eval_at(next, &warm));
            high = next;
            warm = high_eval.q.clone();
            if !high_eval.converged {
                break;
            }
        }

        if !bracketed {
            // Best effort: return the closest point reached.
            return if (high_eval.delta_a_m - target).abs() < (low_eval.delta_a_m - target).abs() {
                high_eval
            } else {
                low_eval
            };
        }

        let mut best = if (low_eval.delta_a_m - target).abs() < (high_eval.delta_a_m - target).abs()
        {
            low_eval.clone()
        } else {
            high_eval.clone()
        };

        for _ in 0..40 {
            let f_low = low_eval.delta_a_m - target;
            let f_high = high_eval.delta_a_m - target;
            if f_low.abs() <= tolerance || f_high.abs() <= tolerance {
                break;
            }

            let denominator = f_high - f_low;
            let secant = if denominator.abs() > EPS {
                high - f_high * (high - low) / denominator
            } else {
                0.5 * (low + high)
            };
            let trial = if secant > low.min(high) && secant < low.max(high) {
                secant
            } else {
                0.5 * (low + high)
            };

            warm = if (trial - low).abs() < (trial - high).abs() {
                low_eval.q.clone()
            } else {
                high_eval.q.clone()
            };
            let trial_eval = eval_at(trial, &warm);
            if (trial_eval.delta_a_m - target).abs() < (best.delta_a_m - target).abs() {
                best = trial_eval.clone();
            }

            if (trial_eval.delta_a_m - target).signum() == (low_eval.delta_a_m - target).signum() {
                low = trial;
                low_eval = trial_eval;
            } else {
                high = trial;
                high_eval = trial_eval;
            }
        }

        best
    }
}

fn apply_hooke(hooke: &[f64; 6], delta: &Vector6<f64>) -> Vector6<f64> {
    Vector6::new(
        hooke[0] * delta[0],
        hooke[1] * delta[1],
        hooke[2] * delta[2],
        hooke[3] * delta[3],
        hooke[4] * delta[4],
        hooke[5] * delta[5],
    )
}

fn body_gravity_wrench(
    orientation: &Pose,
    mass_per_length: f64,
    gravity_world: &Vector3<f64>,
) -> Vector6<f64> {
    if mass_per_length.abs() < EPS {
        return Vector6::zeros();
    }
    let body_gravity = orientation.rotation.transpose() * gravity_world;
    Vector6::new(
        0.0,
        0.0,
        0.0,
        mass_per_length * body_gravity[0],
        mass_per_length * body_gravity[1],
        mass_per_length * body_gravity[2],
    )
}

fn rk4_step<F>(f: &F, s: f64, value: Vector6<f64>, step: f64) -> Vector6<f64>
where
    F: Fn(f64, &Vector6<f64>) -> Vector6<f64>,
{
    let k1 = f(s, &value);
    let k2 = f(s + 0.5 * step, &(value + 0.5 * step * k1));
    let k3 = f(s + 0.5 * step, &(value + 0.5 * step * k2));
    let k4 = f(s + step, &(value + step * k3));
    value + step / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
}

fn simpson_weights(count: usize, length: f64) -> Vec<f64> {
    if count < 2 {
        return vec![0.0; count];
    }
    if count.is_multiple_of(2) {
        // Trapezoid fallback for an even number of nodes.
        let step = length / (count - 1) as f64;
        let mut weights = vec![step; count];
        weights[0] *= 0.5;
        weights[count - 1] *= 0.5;
        return weights;
    }
    let step = length / (count - 1) as f64;
    let mut weights = vec![0.0; count];
    weights[0] = step / 3.0;
    weights[count - 1] = step / 3.0;
    for (index, weight) in weights.iter_mut().enumerate().take(count - 1).skip(1) {
        *weight = if index.is_multiple_of(2) {
            2.0 * step / 3.0
        } else {
            4.0 * step / 3.0
        };
    }
    weights
}

fn lerp(a: f64, b: f64, fraction: f64) -> f64 {
    a + (b - a) * fraction
}

fn lerp_vector6(a: &Vector6<f64>, b: &Vector6<f64>, fraction: f64) -> Vector6<f64> {
    a + (b - a) * fraction
}

/// Small helper used by tests and visualisation to inspect a body angular
/// velocity matrix.
pub fn skew(vector: &Vector3<f64>) -> nalgebra::Matrix3<f64> {
    hat_angular(vector)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{Material, SectionDesign};
    use crate::config::Config;

    fn r1_config() -> Config {
        // Paper design R1: rho1=3, rho1bar=2, rho2=1.5, rho2bar=0.5,
        // k=c=5, l=150, gamma1=5, gamma2=2.
        Config::new(3.0, 1.5, 1.0, 1.0, 5.0, 2.0, 5.0, 5.0, 15, 0.0)
    }

    fn solver(planar: bool, modes: usize) -> SectionSolver {
        let design = SectionDesign::new(r1_config(), Material::PLA);
        let tubes = SectionTubes::from_design(&design);
        let settings = SolverSettings {
            curvature_modes: modes,
            torsion_modes: 2,
            planar,
            samples_per_notch: 4,
            max_iterations: 60,
            residual_tolerance: 1e-8,
            ..Default::default()
        };
        SectionSolver::new(tubes, settings)
    }

    fn no_gravity() -> Vector3<f64> {
        Vector3::zeros()
    }

    fn zero_wrench() -> Vector6<f64> {
        Vector6::zeros()
    }

    #[test]
    fn straight_rest_state_has_zero_residual() {
        let solver = solver(true, 3);
        let q = solver.zero_coefficients();
        let eval = solver.evaluate(&Pose::identity(), &q, 0.0, &zero_wrench(), &no_gravity());
        assert!(eval.residual_norm < 1e-8, "residual {}", eval.residual_norm);
        assert!(eval.delta_a_m.abs() < 1e-12);
        let centerline = eval.centerline_paper();
        // The centroid line `G` is offset from the shared centerline `C` by
        // `D` along `Y`, so a straight section lies at `Y = -D`, not `Y = 0`.
        let offset = solver.tubes.leader.section_at(0.0).centroid_offset_m;
        for point in &centerline {
            assert!((point[1] + offset).abs() < 1e-12);
            assert!(point[2].abs() < 1e-12);
        }
        assert!((centerline.last().unwrap()[0] - solver.tubes.length_m).abs() < 1e-12);
    }

    #[test]
    fn zero_force_with_gravity_only_produces_a_tiny_residual() {
        let solver = solver(true, 3);
        let q = solver.zero_coefficients();
        let eval = solver.evaluate(
            &Pose::identity(),
            &q,
            0.0,
            &zero_wrench(),
            &Vector3::new(-9.81, 0.0, 0.0),
        );
        // Gravity along the rod axis is carried by the axial stiffness; the
        // straight unextended configuration is almost in balance because the
        // Ritz basis does not parameterize axial stretch. The residual is the
        // small coupling of the axial load through the centroid offset.
        assert!(eval.residual_norm < 1e-5, "residual {}", eval.residual_norm);
    }

    #[test]
    fn positive_and_negative_push_pull_bend_in_opposite_directions() {
        let solver = solver(true, 5);
        let positive = solver.solve_displacement(
            &Pose::identity(),
            &solver.zero_coefficients(),
            5e-3,
            &zero_wrench(),
            &no_gravity(),
        );
        let negative = solver.solve_displacement(
            &Pose::identity(),
            &solver.zero_coefficients(),
            -5e-3,
            &zero_wrench(),
            &no_gravity(),
        );

        let positive_tip = positive.centerline_paper().last().unwrap().clone();
        let negative_tip = negative.centerline_paper().last().unwrap().clone();
        assert!(
            positive_tip[1] * negative_tip[1] < 0.0,
            "tips {positive_tip:?} {negative_tip:?}"
        );
        assert!(positive_tip[1].abs() > 1e-4);
        assert!(negative_tip[1].abs() > 1e-4);
    }

    #[test]
    fn displacement_control_matches_the_requested_actuation() {
        let solver = solver(true, 5);
        let target = 3e-3;
        let eval = solver.solve_displacement(
            &Pose::identity(),
            &solver.zero_coefficients(),
            target,
            &zero_wrench(),
            &no_gravity(),
        );
        assert!(
            (eval.delta_a_m - target).abs() < 5e-6,
            "delta_a {} target {}",
            eval.delta_a_m,
            target
        );
    }

    #[test]
    fn base_rotation_is_rigid_without_gravity() {
        let solver = solver(true, 5);
        let q = solver.zero_coefficients();
        let straight = solver.evaluate(&Pose::identity(), &q, 0.0, &zero_wrench(), &no_gravity());
        let rotated = solver.evaluate(
            &Pose::new(
                nalgebra::Rotation3::from_axis_angle(
                    &Vector3::z_axis(),
                    std::f64::consts::FRAC_PI_2,
                ),
                Vector3::new(0.01, 0.02, 0.03),
            ),
            &q,
            0.0,
            &zero_wrench(),
            &no_gravity(),
        );

        let straight_tip = straight.centerline_paper().last().unwrap().clone();
        let rotated_tip = rotated.centerline_paper().last().unwrap().clone();
        let expected =
            nalgebra::Rotation3::from_axis_angle(&Vector3::z_axis(), std::f64::consts::FRAC_PI_2)
                * straight_tip
                + Vector3::new(0.01, 0.02, 0.03);
        assert!((rotated_tip - expected).norm() < 1e-12);
    }

    #[test]
    fn out_of_plane_torsion_couples_into_the_3d_solution() {
        let solver = solver(false, 3);
        let mut q = solver.zero_coefficients();
        // Excite a torsion mode only.
        let torsion = solver.torsion_slice();
        q[torsion.start] = 0.5;
        let eval = solver.evaluate(&Pose::identity(), &q, 0.0, &zero_wrench(), &no_gravity());
        // A pure torsion of the follower should not be exactly zero work.
        assert!(eval.residual_norm > 0.0);
        assert!(eval.nodes.iter().any(|node| node.theta.abs() > 0.0));
    }

    #[test]
    fn force_control_with_a_transverse_tip_load_bends_toward_the_load() {
        let solver = solver(true, 5);
        let force = Vector6::new(0.0, 0.0, 0.0, 0.0, 0.05, 0.0);
        let eval = solver.solve_force(
            &Pose::identity(),
            &solver.zero_coefficients(),
            0.0,
            &force,
            &no_gravity(),
        );
        let tip = eval.centerline_paper().last().unwrap().clone();
        assert!(tip[1] > 1e-5, "tip {tip:?}");
    }

    #[test]
    fn all_status_fields_are_finite() {
        let solver = solver(false, 3);
        let eval = solver.solve_displacement(
            &Pose::identity(),
            &solver.zero_coefficients(),
            2e-3,
            &zero_wrench(),
            &Vector3::new(0.0, -9.81, 0.0),
        );
        assert!(eval.residual_norm.is_finite());
        assert!(eval.delta_a_m.is_finite());
        for node in &eval.nodes {
            assert!(node.g1.translation.norm().is_finite());
            assert!(node.gk.translation.norm().is_finite());
            assert!(node.xik.norm().is_finite());
        }
    }
}
