//! SE(3) helpers and Ritz bases for the 3D Cosserat model.
//!
//! Twists and wrenches use the paper's ordering
//! `(KX, KY, KZ, GammaX, GammaY, GammaZ)` for twists and
//! `(MX, MY, MZ, NX, NY, NZ)` for wrenches. The first three components are
//! angular, the last three are linear. Poses follow `g' = g xi^`.

#[cfg(test)]
use std::f64::consts::PI;

use nalgebra::{Matrix3, Matrix4, Matrix6, Rotation3, Vector3, Vector6};

use crate::backend::matrix4_to_array;

/// A rigid transform in the paper's `(X, Y, Z)` frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pose {
    pub rotation: Rotation3<f64>,
    pub translation: Vector3<f64>,
}

impl Pose {
    pub fn identity() -> Self {
        Self {
            rotation: Rotation3::identity(),
            translation: Vector3::zeros(),
        }
    }

    pub fn new(rotation: Rotation3<f64>, translation: Vector3<f64>) -> Self {
        Self {
            rotation,
            translation,
        }
    }

    /// `self * other`: apply `other` first, then `self`.
    pub fn compose(&self, other: &Self) -> Self {
        Self {
            rotation: self.rotation * other.rotation,
            translation: self.translation + self.rotation * other.translation,
        }
    }

    pub fn inverse(&self) -> Self {
        let rotation = self.rotation.transpose();
        Self {
            rotation,
            translation: -(rotation * self.translation),
        }
    }

    pub fn transform_point(&self, point: Vector3<f64>) -> Vector3<f64> {
        self.rotation * point + self.translation
    }

    pub fn transform_vector(&self, vector: Vector3<f64>) -> Vector3<f64> {
        self.rotation * vector
    }

    pub fn to_matrix4(&self) -> Matrix4<f64> {
        let mut matrix = Matrix4::identity();
        matrix
            .fixed_view_mut::<3, 3>(0, 0)
            .copy_from(self.rotation.matrix());
        matrix
            .fixed_view_mut::<3, 1>(0, 3)
            .copy_from(&self.translation);
        matrix
    }

    pub fn to_array(&self) -> [[f64; 4]; 4] {
        matrix4_to_array(&self.to_matrix4())
    }

    /// Group adjoint `Ad_g`, mapping body twists to the parent frame.
    pub fn adjoint(&self) -> Matrix6<f64> {
        let rotation = *self.rotation.matrix();
        let translation_hat = hat_angular(&self.translation);
        let mut adjoint = Matrix6::zeros();
        adjoint.fixed_view_mut::<3, 3>(0, 0).copy_from(&rotation);
        adjoint
            .fixed_view_mut::<3, 3>(3, 0)
            .copy_from(&(translation_hat * rotation));
        adjoint.fixed_view_mut::<3, 3>(3, 3).copy_from(&rotation);
        adjoint
    }

    /// Transforms a wrench from this frame's child frame to this frame.
    ///
    /// This is `Ad_g^{-T}`: if `g` is the pose of the child frame in the
    /// parent frame and `lambda_child` is expressed in the child frame,
    /// `Ad_g^{-T} lambda_child` is the same wrench in the parent frame.
    pub fn wrench_from_child(&self, wrench_child: &Vector6<f64>) -> Vector6<f64> {
        self.inverse().adjoint().transpose() * wrench_child
    }

    /// Exponential map of the body twist `xi` over step `dt`.
    pub fn exp(xi: &Vector6<f64>, dt: f64) -> Self {
        let angular = Vector3::new(xi[0], xi[1], xi[2]) * dt;
        let linear = Vector3::new(xi[3], xi[4], xi[5]) * dt;
        let theta = angular.norm();

        if theta < 1e-12 {
            let rotation =
                Rotation3::from_matrix_unchecked(Matrix3::identity() + hat_angular(&angular));
            return Self {
                rotation,
                translation: linear,
            };
        }

        let omega_hat = hat_angular(&angular);
        let omega_hat_squared = omega_hat * omega_hat;
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();

        let rotation_matrix = Matrix3::identity()
            + (sin_theta / theta) * omega_hat
            + ((1.0 - cos_theta) / (theta * theta)) * omega_hat_squared;
        // Rotation3 does not expose a checked constructor from an arbitrary
        // matrix; the Rodrigues form is orthonormal up to round-off.
        let rotation = Rotation3::from_matrix_unchecked(rotation_matrix);

        let v = Matrix3::identity()
            + ((1.0 - cos_theta) / (theta * theta)) * omega_hat
            + ((theta - sin_theta) / (theta * theta * theta)) * omega_hat_squared;

        Self {
            rotation,
            translation: v * linear,
        }
    }
}

/// Skew-symmetric matrix of a 3-vector.
pub fn hat_angular(vector: &Vector3<f64>) -> Matrix3<f64> {
    Matrix3::new(
        0.0, -vector[2], vector[1], vector[2], 0.0, -vector[0], -vector[1], vector[0], 0.0,
    )
}

/// 4×4 `se(3)` matrix of a twist.
pub fn se3_hat(xi: &Vector6<f64>) -> Matrix4<f64> {
    let angular = Vector3::new(xi[0], xi[1], xi[2]);
    let linear = Vector3::new(xi[3], xi[4], xi[5]);
    let mut matrix = Matrix4::zeros();
    matrix
        .fixed_view_mut::<3, 3>(0, 0)
        .copy_from(&hat_angular(&angular));
    matrix.fixed_view_mut::<3, 1>(0, 3).copy_from(&linear);
    matrix
}

/// 6×6 `ad_xi` operator on twists.
pub fn ad(xi: &Vector6<f64>) -> Matrix6<f64> {
    let angular = Vector3::new(xi[0], xi[1], xi[2]);
    let linear = Vector3::new(xi[3], xi[4], xi[5]);
    let mut matrix = Matrix6::zeros();
    matrix
        .fixed_view_mut::<3, 3>(0, 0)
        .copy_from(&hat_angular(&angular));
    matrix
        .fixed_view_mut::<3, 3>(3, 0)
        .copy_from(&hat_angular(&linear));
    matrix
        .fixed_view_mut::<3, 3>(3, 3)
        .copy_from(&hat_angular(&angular));
    matrix
}

/// `ad_xi * eta`, the Lie bracket of two twists.
///
/// Written out in terms of cross products: building the 6×6 matrix only to
/// multiply one vector dominates the statics pass otherwise.
pub fn ad_mul(xi: &Vector6<f64>, eta: &Vector6<f64>) -> Vector6<f64> {
    let omega = Vector3::new(xi[0], xi[1], xi[2]);
    let linear = Vector3::new(xi[3], xi[4], xi[5]);
    let eta_angular = Vector3::new(eta[0], eta[1], eta[2]);
    let eta_linear = Vector3::new(eta[3], eta[4], eta[5]);
    let angular = omega.cross(&eta_angular);
    let linear = omega.cross(&eta_linear) + linear.cross(&eta_angular);
    Vector6::new(
        angular[0], angular[1], angular[2], linear[0], linear[1], linear[2],
    )
}

/// `ad_xi^T * lambda`, the dual action on a wrench.
pub fn ad_transpose_mul(xi: &Vector6<f64>, lambda: &Vector6<f64>) -> Vector6<f64> {
    let omega = Vector3::new(xi[0], xi[1], xi[2]);
    let linear = Vector3::new(xi[3], xi[4], xi[5]);
    let lambda_angular = Vector3::new(lambda[0], lambda[1], lambda[2]);
    let lambda_linear = Vector3::new(lambda[3], lambda[4], lambda[5]);
    let angular = -(omega.cross(&lambda_angular) + linear.cross(&lambda_linear));
    let linear = -(omega.cross(&lambda_linear));
    Vector6::new(
        angular[0], angular[1], angular[2], linear[0], linear[1], linear[2],
    )
}

/// Pose of a follower cross-section relative to the leader, Eq. (71).
///
/// `theta` is the total follower torsion angle `theta_o + Delta theta` in
/// radians. `d1` and `dk` are the leader and follower centroid offsets.
pub fn relative_pose(theta: f64, d1: f64, dk: f64) -> Pose {
    let (sin_theta, cos_theta) = theta.sin_cos();
    relative_pose_from_sin_cos(sin_theta, cos_theta, d1, dk)
}

/// [`relative_pose`] with the sine and cosine of `theta` already available.
///
/// `R = Rz(pi) Rx(theta)` and the centroid offset along `y` have closed forms,
/// so this avoids two axis-angle constructions and two matrix products per
/// node per projection.
pub fn relative_pose_from_sin_cos(sin_theta: f64, cos_theta: f64, d1: f64, dk: f64) -> Pose {
    let rotation = Rotation3::from_matrix_unchecked(Matrix3::new(
        -1.0, 0.0, 0.0, //
        0.0, -cos_theta, sin_theta, //
        0.0, sin_theta, cos_theta,
    ));
    let translation = Vector3::new(0.0, -(d1 + dk * cos_theta), dk * sin_theta);
    Pose::new(rotation, translation)
}

/// First `n` Legendre polynomials `P_0 .. P_{n-1}` at `x`.
pub fn legendre_values(n: usize, x: f64) -> Vec<f64> {
    let mut values = Vec::with_capacity(n);
    if n == 0 {
        return values;
    }
    values.push(1.0);
    if n == 1 {
        return values;
    }
    values.push(x);
    for degree in 1..n - 1 {
        let next = ((2 * degree + 1) as f64 * x * values[degree]
            - degree as f64 * values[degree - 1])
            / (degree + 1) as f64;
        values.push(next);
    }
    values
}

/// Derivatives `dP_k/dx` for `k = 0 .. n-1` at `x`.
pub fn legendre_derivatives(n: usize, x: f64) -> Vec<f64> {
    legendre_values_and_derivatives(n, x).1
}

/// Values and derivatives of the first `n` Legendre polynomials at `x`,
/// evaluated in a single pass.
pub fn legendre_values_and_derivatives(n: usize, x: f64) -> (Vec<f64>, Vec<f64>) {
    let values = legendre_values(n, x);
    let mut derivatives = Vec::with_capacity(n);
    if n == 0 {
        return (values, derivatives);
    }
    derivatives.push(0.0);
    if n == 1 {
        return (values, derivatives);
    }
    derivatives.push(1.0);
    for degree in 1..n - 1 {
        let next = derivatives[degree - 1] + (2 * degree + 1) as f64 * values[degree];
        derivatives.push(next);
    }
    (values, derivatives)
}

/// Torsion basis adapted to `Phi_theta(l) = 0`, Eq. (87).
///
/// Mode `j` is `P_{j+1}(x) - P_{j+1}(1)`, so every mode vanishes at the distal
/// end and the first two modes are exactly the paper's adapted basis.
pub fn torsion_basis(n: usize, x: f64) -> Vec<f64> {
    let values = legendre_values(n + 1, x);
    (1..=n).map(|degree| values[degree] - 1.0).collect()
}

/// Derivatives with respect to `x` of [`torsion_basis`].
pub fn torsion_basis_derivatives(n: usize, x: f64) -> Vec<f64> {
    let derivatives = legendre_derivatives(n + 1, x);
    (1..=n).map(|degree| derivatives[degree]).collect()
}

/// Maps an arc length `s` in `[0, length]` to the Legendre domain `[-1, 1]`.
pub fn legendre_coordinate(s: f64, length_m: f64) -> f64 {
    if length_m.abs() < 1e-15 {
        0.0
    } else {
        2.0 * s / length_m - 1.0
    }
}

/// Curvature and torsion Ritz basis for one section.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RitzBasis {
    pub length_m: f64,
    /// Modes per curvature component in 3D, or total modes in planar mode.
    pub curvature_modes: usize,
    pub torsion_modes: usize,
    /// When true only `K1Z` is expanded, matching the paper's 2D validation.
    pub planar: bool,
}

impl RitzBasis {
    pub fn curvature_coefficients(&self) -> usize {
        if self.planar {
            self.curvature_modes
        } else {
            3 * self.curvature_modes
        }
    }

    /// Values of the scalar curvature basis and their `s` derivatives.
    pub fn curvature(&self, s: f64) -> (Vec<f64>, Vec<f64>) {
        self.curvature_at(legendre_coordinate(s, self.length_m))
    }

    /// Curvature basis values and derivatives at a Legendre coordinate `x`.
    pub fn curvature_at(&self, x: f64) -> (Vec<f64>, Vec<f64>) {
        let (values, derivatives) = legendre_values_and_derivatives(self.curvature_modes, x);
        let scale = if self.length_m.abs() < 1e-15 {
            0.0
        } else {
            2.0 / self.length_m
        };
        let derivatives = derivatives.into_iter().map(|value| value * scale).collect();
        (values, derivatives)
    }

    /// Values of the torsion basis and their `s` derivatives.
    pub fn torsion(&self, s: f64) -> (Vec<f64>, Vec<f64>) {
        self.torsion_at(legendre_coordinate(s, self.length_m))
    }

    /// Torsion basis values and derivatives at a Legendre coordinate `x`.
    pub fn torsion_at(&self, x: f64) -> (Vec<f64>, Vec<f64>) {
        let values = torsion_basis(self.torsion_modes, x);
        let derivatives = torsion_basis_derivatives(self.torsion_modes, x);
        let scale = if self.length_m.abs() < 1e-15 {
            0.0
        } else {
            2.0 / self.length_m
        };
        let derivatives = derivatives.into_iter().map(|value| value * scale).collect();
        (values, derivatives)
    }

    /// Builds `Delta K1(s)` from the curvature coefficients.
    pub fn curvature_vector(&self, s: f64, coefficients: &[f64]) -> Vector3<f64> {
        let (values, _) = self.curvature(s);
        self.curvature_vector_from_values(&values, coefficients)
    }

    /// `Delta K1` from precomputed basis values. Avoids re-evaluating the
    /// Legendre basis when the caller already has it.
    pub fn curvature_vector_from_values(
        &self,
        values: &[f64],
        coefficients: &[f64],
    ) -> Vector3<f64> {
        if self.planar {
            let mut curvature = Vector3::zeros();
            curvature[2] = dot_prefix(values, coefficients);
            curvature
        } else {
            let modes = self.curvature_modes;
            Vector3::new(
                dot_prefix(values, coefficients.get(0..modes).unwrap_or(&[])),
                dot_prefix(values, coefficients.get(modes..2 * modes).unwrap_or(&[])),
                dot_prefix(
                    values,
                    coefficients.get(2 * modes..3 * modes).unwrap_or(&[]),
                ),
            )
        }
    }

    /// Builds `Delta theta(s)` and its `s` derivative from torsion coefficients.
    pub fn torsion_value(&self, s: f64, coefficients: &[f64]) -> (f64, f64) {
        let (values, derivatives) = self.torsion(s);
        self.torsion_value_from_values(&values, &derivatives, coefficients)
    }

    /// `(Delta theta, dDelta theta/ds)` from precomputed basis values.
    pub fn torsion_value_from_values(
        &self,
        values: &[f64],
        derivatives: &[f64],
        coefficients: &[f64],
    ) -> (f64, f64) {
        (
            dot_prefix(values, coefficients),
            dot_prefix(derivatives, coefficients),
        )
    }
}

fn dot_prefix(values: &[f64], coefficients: &[f64]) -> f64 {
    values
        .iter()
        .zip(coefficients)
        .map(|(value, coefficient)| value * coefficient)
        .sum()
}

/// Converts a public base pose (mm, degrees) into an internal SI pose.
///
/// The repo's model frame uses `+z` as the axial direction; the paper uses
/// `+X`. The paper frame `(X, Y, Z)` maps to the repo frame as
/// `X -> z`, `Y -> x`, `Z -> y`.
pub fn base_pose_from_public(
    x_mm: f64,
    y_mm: f64,
    z_mm: f64,
    roll_deg: f64,
    pitch_deg: f64,
    yaw_deg: f64,
) -> Pose {
    let rotation = Rotation3::from_euler_angles(
        roll_deg.to_radians(),
        pitch_deg.to_radians(),
        yaw_deg.to_radians(),
    );
    let repo_translation = Vector3::new(x_mm, y_mm, z_mm) * 1e-3;
    // Repo (x, y, z) -> paper (X, Y, Z) = (z, x, y).
    let paper_translation = Vector3::new(
        repo_translation[2],
        repo_translation[0],
        repo_translation[1],
    );
    let paper_to_repo = paper_to_repo_rotation();
    let paper_rotation = paper_to_repo.transpose() * rotation * paper_to_repo;
    Pose::new(paper_rotation, paper_translation)
}

/// Rotation mapping paper coordinates to repo coordinates.
///
/// `repo = Q * paper` with `Q * (X, Y, Z) = (Y, Z, X)`.
pub fn paper_to_repo_rotation() -> Rotation3<f64> {
    Rotation3::from_matrix_unchecked(Matrix3::new(
        0.0, 1.0, 0.0, //
        0.0, 0.0, 1.0, //
        1.0, 0.0, 0.0,
    ))
}

/// Converts a pose from the paper frame into the repo model frame.
pub fn pose_paper_to_repo(pose: &Pose) -> Pose {
    let q = paper_to_repo_rotation();
    Pose::new(q * pose.rotation * q.transpose(), q * pose.translation)
}

/// Converts a point from the paper frame into the repo model frame.
pub fn point_paper_to_repo(point: &Vector3<f64>) -> Vector3<f64> {
    paper_to_repo_rotation() * point
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn exp_of_zero_is_identity() {
        let pose = Pose::exp(&Vector6::zeros(), 1.0);
        assert!(close(pose.translation.norm(), 0.0));
        assert!(close(pose.rotation.matrix()[(0, 0)], 1.0));
    }

    #[test]
    fn exp_of_translation_moves_along_the_linear_part() {
        let xi = Vector6::new(0.0, 0.0, 0.0, 1.0, 2.0, 3.0);
        let pose = Pose::exp(&xi, 0.5);
        assert!(close(pose.translation[0], 0.5));
        assert!(close(pose.translation[1], 1.0));
        assert!(close(pose.translation[2], 1.5));
    }

    #[test]
    fn exp_of_rotation_turns_a_point() {
        let xi = Vector6::new(0.0, 0.0, PI, 0.0, 0.0, 0.0);
        let pose = Pose::exp(&xi, 0.5);
        let point = pose.transform_point(Vector3::new(1.0, 0.0, 0.0));
        assert!(close(point[0], 0.0));
        assert!(close(point[1], 1.0));
        assert!(close(point[2], 0.0));
    }

    #[test]
    fn adjoint_composes() {
        let g1 = Pose::new(
            Rotation3::from_euler_angles(0.2, -0.3, 0.4),
            Vector3::new(1.0, -2.0, 3.0),
        );
        let g2 = Pose::new(
            Rotation3::from_euler_angles(-0.1, 0.5, 0.2),
            Vector3::new(-0.5, 0.7, 0.1),
        );
        let left = g1.compose(&g2).adjoint();
        let right = g1.adjoint() * g2.adjoint();
        assert!((left - right).norm() < 1e-12);
    }

    #[test]
    fn ad_matches_the_lie_bracket() {
        let xi = Vector6::new(0.3, -0.4, 0.5, 0.7, -0.2, 0.1);
        let eta = Vector6::new(-0.1, 0.2, 0.6, -0.3, 0.4, 0.5);
        let bracket = ad_mul(&xi, &eta);
        let angular =
            Vector3::new(xi[0], xi[1], xi[2]).cross(&Vector3::new(eta[0], eta[1], eta[2]));
        let linear = Vector3::new(xi[0], xi[1], xi[2]).cross(&Vector3::new(eta[3], eta[4], eta[5]))
            + Vector3::new(xi[3], xi[4], xi[5]).cross(&Vector3::new(eta[0], eta[1], eta[2]));
        assert!(close(bracket[0], angular[0]));
        assert!(close(bracket[1], angular[1]));
        assert!(close(bracket[2], angular[2]));
        assert!(close(bracket[3], linear[0]));
        assert!(close(bracket[4], linear[1]));
        assert!(close(bracket[5], linear[2]));
    }

    #[test]
    fn ad_transpose_is_the_dual() {
        let xi = Vector6::new(0.3, -0.4, 0.5, 0.7, -0.2, 0.1);
        let eta = Vector6::new(-0.1, 0.2, 0.6, -0.3, 0.4, 0.5);
        let lambda = Vector6::new(0.8, -0.6, 0.2, 0.1, 0.9, -0.4);
        let left = ad_mul(&xi, &eta).dot(&lambda);
        let right = eta.dot(&ad_transpose_mul(&xi, &lambda));
        assert!(close(left, right));
    }

    #[test]
    fn relative_pose_at_zero_torsion_flips_the_axis() {
        let pose = relative_pose(0.0, 0.003, 0.002);
        assert!(close(pose.translation[0], 0.0));
        assert!(close(pose.translation[1], -0.005));
        assert!(close(pose.translation[2], 0.0));
        let axis = pose.transform_vector(Vector3::new(1.0, 0.0, 0.0));
        assert!(close(axis[0], -1.0));
    }

    #[test]
    fn legendre_values_match_the_closed_forms() {
        let values = legendre_values(4, 0.3);
        assert!(close(values[0], 1.0));
        assert!(close(values[1], 0.3));
        assert!(close(values[2], (3.0 * 0.09 - 1.0) / 2.0));
        assert!(close(values[3], (5.0 * 0.027 - 3.0 * 0.3) / 2.0));
    }

    #[test]
    fn legendre_derivatives_match_finite_differences() {
        let x = 0.37;
        let h = 1e-7;
        let derivatives = legendre_derivatives(6, x);
        let plus = legendre_values(6, x + h);
        let minus = legendre_values(6, x - h);
        for index in 0..6 {
            let numerical = (plus[index] - minus[index]) / (2.0 * h);
            assert!((derivatives[index] - numerical).abs() < 1e-6);
        }
    }

    #[test]
    fn torsion_basis_vanishes_at_the_tip() {
        for modes in 1..5 {
            for value in torsion_basis(modes, 1.0) {
                assert!(value.abs() < 1e-12);
            }
        }
    }

    #[test]
    fn toeplitz_basis_derivative_matches_finite_differences() {
        let x = -0.2;
        let h = 1e-7;
        let derivatives = torsion_basis_derivatives(4, x);
        let plus = torsion_basis(4, x + h);
        let minus = torsion_basis(4, x - h);
        for index in 0..4 {
            let numerical = (plus[index] - minus[index]) / (2.0 * h);
            assert!((derivatives[index] - numerical).abs() < 1e-6);
        }
    }

    #[test]
    fn paper_to_repo_rotation_is_proper() {
        let rotation = paper_to_repo_rotation();
        assert!(close(rotation.matrix().determinant(), 1.0));
        let mapped = rotation * Vector3::new(1.0, 0.0, 0.0);
        assert!(close(mapped[2], 1.0));
    }

    #[test]
    fn planar_basis_uses_only_the_z_component() {
        let basis = RitzBasis {
            length_m: 0.1,
            curvature_modes: 3,
            torsion_modes: 2,
            planar: true,
        };
        let coefficients = vec![1.0, 2.0, 3.0];
        let curvature = basis.curvature_vector(0.05, &coefficients);
        assert_eq!(curvature[0], 0.0);
        assert_eq!(curvature[1], 0.0);
        assert!(curvature[2].abs() > 0.0);
    }

    #[test]
    fn three_dimensional_basis_has_independent_components() {
        let basis = RitzBasis {
            length_m: 0.1,
            curvature_modes: 3,
            torsion_modes: 2,
            planar: false,
        };
        let mut coefficients = vec![0.0; 9];
        coefficients[0] = 1.0;
        coefficients[3] = 2.0;
        coefficients[6] = 3.0;
        let curvature = basis.curvature_vector(0.05, &coefficients);
        assert!(curvature[0].abs() > 0.0);
        assert!(curvature[1].abs() > 0.0);
        assert!(curvature[2].abs() > 0.0);
    }
}
