//! Cross-sectional geometry and stiffness of notched tubes.
//!
//! This follows Appendix B of Tummers et al. (2025). The wall of a tube is the
//! remaining part of an annulus after a straight notch of depth `gamma` is cut
//! from the `-Y` side. The formulas are evaluated in metres; the public design
//! is in millimetres and is converted by [`TubeProfile::from_config`].

use crate::backend::Material;
use crate::config::Config;

const EPS: f64 = 1e-15;

/// The part of a full disk on the `Y > alpha` side of a straight cut.
#[derive(Debug, Clone, Copy, PartialEq)]
struct DiskSegment {
    /// Half-angle of the remaining segment, in radians.
    phi: f64,
    /// Area, m².
    area: f64,
    /// Centroid offset from the disk centre along `+Y`, m.
    y_centroid: f64,
    /// Second moment about the `Y` axis through the disk centre, m⁴.
    jy: f64,
    /// Second moment about the `Z` axis through the disk centre, m⁴.
    jz: f64,
}

impl DiskSegment {
    fn new(radius: f64, alpha: f64) -> Self {
        let radius = radius.max(0.0);
        if radius <= EPS {
            return Self {
                phi: 0.0,
                area: 0.0,
                y_centroid: 0.0,
                jy: 0.0,
                jz: 0.0,
            };
        }

        let ratio = (alpha / radius).clamp(-1.0, 1.0);
        let phi = 2.0 * ratio.acos();
        let area = radius * radius * (phi - phi.sin()) / 2.0;
        let denominator = 3.0 * (phi - phi.sin());
        let y_centroid = if denominator.abs() > EPS {
            4.0 * radius * (0.5 * phi).sin().powi(3) / denominator
        } else {
            0.0
        };

        // psi = asin(alpha / radius) = pi/2 - phi/2, which keeps the
        // expressions finite at the full-disk and empty-disk limits.
        let psi = std::f64::consts::FRAC_PI_2 - 0.5 * phi;
        let psi_y =
            6.0 * std::f64::consts::PI - 12.0 * psi - 8.0 * (2.0 * psi).sin() - (4.0 * psi).sin();
        let psi_z = 2.0 * std::f64::consts::PI - 4.0 * psi + (4.0 * psi).sin();

        Self {
            phi,
            area,
            y_centroid,
            jy: radius.powi(4) / 48.0 * psi_y,
            jz: radius.powi(4) / 16.0 * psi_z,
        }
    }
}

/// Area and inertia of one notched tube cross-section.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CrossSection {
    /// Remaining wall area, m².
    pub area_m2: f64,
    /// Centroid offset from the CPPR centerline along `+Y`, m.
    pub centroid_offset_m: f64,
    /// Second moment about the centroid's `Y` axis, m⁴.
    pub iy_m4: f64,
    /// Second moment about the centroid's `Z` axis, m⁴.
    pub iz_m4: f64,
    /// Polar second moment about the centroid's `X` axis, m⁴.
    pub ix_m4: f64,
}

impl CrossSection {
    /// Builds the remaining wall of a notched tube.
    ///
    /// `radius_outer` and `radius_inner` are the tube's outer and bore radii;
    /// `notch_depth` is measured from the outer surface, so `0` is a full
    /// annulus. All lengths are metres.
    pub fn notched(radius_outer: f64, radius_inner: f64, notch_depth: f64) -> Self {
        let radius_outer = radius_outer.max(0.0);
        let radius_inner = radius_inner.clamp(0.0, radius_outer);
        let alpha = notch_depth - radius_outer;

        let outer = DiskSegment::new(radius_outer, alpha);
        let inner = DiskSegment::new(radius_inner, alpha);

        let area = outer.area - inner.area;
        let centroid_offset = if area.abs() > EPS {
            (outer.y_centroid * outer.area - inner.y_centroid * inner.area) / area
        } else {
            0.0
        };

        let jy = outer.jy - inner.jy;
        let jz = outer.jz - inner.jz;
        let jx = jy + jz;

        // Huygens transport from the disk centre C to the centroid G. The
        // centroid shift is along Y, so IY is unchanged.
        let iy = jy;
        let iz = (jz - area * centroid_offset * centroid_offset).max(0.0);
        let ix = (jx - area * centroid_offset * centroid_offset).max(0.0);

        Self {
            area_m2: area,
            centroid_offset_m: centroid_offset,
            iy_m4: iy,
            iz_m4: iz,
            ix_m4: ix,
        }
    }

    /// Diagonal Hooke matrix in the paper's order
    /// `(KX, KY, KZ, GammaX, GammaY, GammaZ)`, i.e.
    /// `diag(G IX, E IY, E IZ, E A, G A, G A)`.
    pub fn hooke_diagonal(&self, material: &Material, shear_override_pa: Option<f64>) -> [f64; 6] {
        let e = material.youngs_modulus_pa;
        let g = shear_override_pa.unwrap_or_else(|| material.shear_modulus_pa());
        [
            g * self.ix_m4,
            e * self.iy_m4,
            e * self.iz_m4,
            e * self.area_m2,
            g * self.area_m2,
            g * self.area_m2,
        ]
    }
}

/// A one-dimensional design field sampled at the notch midpoints and
/// interpolated with a natural cubic spline (Eq. 1 of the paper).
#[derive(Debug, Clone, PartialEq)]
pub struct ScalarProfile {
    x_m: Vec<f64>,
    y: Vec<f64>,
    /// Second derivatives at the samples for a natural cubic spline.
    second: Vec<f64>,
    constant: Option<f64>,
}

impl ScalarProfile {
    pub fn constant(value: f64) -> Self {
        Self {
            x_m: Vec::new(),
            y: Vec::new(),
            second: Vec::new(),
            constant: Some(value),
        }
    }

    /// Builds a natural cubic spline through `(x, y)`.
    ///
    /// Duplicate or non-finite samples collapse to their mean so a malformed
    /// design cannot panic the solver.
    pub fn spline(x_m: Vec<f64>, y: Vec<f64>) -> Self {
        assert_eq!(x_m.len(), y.len(), "x and y must have the same length");
        if x_m.is_empty() {
            return Self::constant(0.0);
        }
        if x_m.len() == 1 {
            return Self::constant(y[0]);
        }

        let mut points: Vec<(f64, f64)> = x_m
            .into_iter()
            .zip(y)
            .filter(|(x, y)| x.is_finite() && y.is_finite())
            .collect();
        points.sort_by(|a, b| a.0.total_cmp(&b.0));
        points.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-15);

        if points.len() == 1 {
            return Self::constant(points[0].1);
        }

        let x_m: Vec<f64> = points.iter().map(|(x, _)| *x).collect();
        let y: Vec<f64> = points.iter().map(|(_, y)| *y).collect();
        let second = natural_cubic_second_derivatives(&x_m, &y);

        Self {
            x_m,
            y,
            second,
            constant: None,
        }
    }

    /// Builds the notch-depth profile for one tube.
    ///
    /// `per_notch_mm` is indexed proximal to distal. When it is absent or has a
    /// different length, values are resampled linearly to the number of
    /// segments.
    pub fn from_notch_samples(
        config: &Config,
        per_notch_mm: Option<&[f64]>,
        fallback_mm: f64,
    ) -> Self {
        let segments = config.segments.max(1);
        let uncut = config.uncut_length as f64 * 1e-3;
        let notch = config.notch_length as f64 * 1e-3;
        let pitch = uncut + notch;

        let x_m: Vec<f64> = (0..segments)
            .map(|index| index as f64 * pitch + uncut + 0.5 * notch)
            .collect();

        let values: Vec<f64> = match per_notch_mm {
            Some(values) if !values.is_empty() => {
                let values: Vec<f64> = values.iter().map(|v| v * 1e-3).collect();
                if values.len() == segments {
                    values
                } else if values.len() == 1 {
                    vec![values[0]; segments]
                } else {
                    (0..segments)
                        .map(|index| {
                            let t = if segments == 1 {
                                0.0
                            } else {
                                index as f64 / (segments - 1) as f64
                            };
                            let position = t * (values.len() - 1) as f64;
                            let low = position.floor() as usize;
                            let high = position.ceil() as usize;
                            let fraction = position - low as f64;
                            values[low] * (1.0 - fraction) + values[high] * fraction
                        })
                        .collect()
                }
            }
            _ => vec![fallback_mm * 1e-3; segments],
        };

        if segments == 1 {
            Self::constant(values[0])
        } else {
            Self::spline(x_m, values)
        }
    }

    pub fn is_constant(&self) -> bool {
        self.constant.is_some()
    }

    /// Value at `x`, clamped to the sampled range outside the first/last notch.
    pub fn value(&self, x: f64) -> f64 {
        if let Some(value) = self.constant {
            return value;
        }
        let last = self.x_m.len() - 1;
        if x <= self.x_m[0] {
            return self.y[0];
        }
        if x >= self.x_m[last] {
            return self.y[last];
        }

        let index = self
            .x_m
            .partition_point(|sample| *sample <= x)
            .saturating_sub(1)
            .min(last - 1);
        let h = self.x_m[index + 1] - self.x_m[index];
        if h.abs() < EPS {
            return self.y[index];
        }
        let a = (self.x_m[index + 1] - x) / h;
        let b = (x - self.x_m[index]) / h;
        a * self.y[index]
            + b * self.y[index + 1]
            + ((a * a * a - a) * self.second[index] + (b * b * b - b) * self.second[index + 1])
                * h
                * h
                / 6.0
    }

    /// First derivative with respect to `x`.
    pub fn derivative(&self, x: f64) -> f64 {
        if self.constant.is_some() {
            return 0.0;
        }
        let last = self.x_m.len() - 1;
        if x <= self.x_m[0] || x >= self.x_m[last] {
            return 0.0;
        }

        let index = self
            .x_m
            .partition_point(|sample| *sample <= x)
            .saturating_sub(1)
            .min(last - 1);
        let h = self.x_m[index + 1] - self.x_m[index];
        if h.abs() < EPS {
            return 0.0;
        }
        let a = (self.x_m[index + 1] - x) / h;
        let b = (x - self.x_m[index]) / h;
        (self.y[index + 1] - self.y[index]) / h
            + h / 6.0
                * (-(3.0 * a * a - 1.0) * self.second[index]
                    + (3.0 * b * b - 1.0) * self.second[index + 1])
    }
}

fn natural_cubic_second_derivatives(x: &[f64], y: &[f64]) -> Vec<f64> {
    let n = x.len();
    let mut second = vec![0.0; n];
    if n <= 2 {
        return second;
    }

    let mut lower = vec![0.0; n];
    let mut diagonal = vec![1.0; n];
    let mut upper = vec![0.0; n];
    let mut rhs = vec![0.0; n];

    for index in 1..n - 1 {
        let h_prev = x[index] - x[index - 1];
        let h_next = x[index + 1] - x[index];
        lower[index] = h_prev;
        diagonal[index] = 2.0 * (h_prev + h_next);
        upper[index] = h_next;
        rhs[index] =
            6.0 * ((y[index + 1] - y[index]) / h_next - (y[index] - y[index - 1]) / h_prev);
    }

    // Thomas algorithm; the first and last rows are the natural BCs.
    for index in 1..n {
        let factor = lower[index] / diagonal[index - 1];
        diagonal[index] -= factor * upper[index - 1];
        rhs[index] -= factor * rhs[index - 1];
    }
    second[n - 1] = rhs[n - 1] / diagonal[n - 1];
    for index in (0..n - 1).rev() {
        second[index] = (rhs[index] - upper[index] * second[index + 1]) / diagonal[index];
    }
    second
}

/// Geometry and material of one tube along its length.
#[derive(Debug, Clone, PartialEq)]
pub struct TubeProfile {
    pub radius_outer_m: f64,
    pub radius_inner_m: f64,
    pub depth_m: ScalarProfile,
    pub material: Material,
    /// When set, overrides the isotropic shear modulus (paper-parity mode).
    pub shear_modulus_override_pa: Option<f64>,
}

impl TubeProfile {
    pub fn from_config(
        config: &Config,
        radius_outer_mm: f64,
        radius_inner_mm: f64,
        depth_mm: f64,
        per_notch_mm: Option<&[f64]>,
        material: Material,
    ) -> Self {
        Self {
            radius_outer_m: radius_outer_mm * 1e-3,
            radius_inner_m: radius_inner_mm * 1e-3,
            depth_m: ScalarProfile::from_notch_samples(config, per_notch_mm, depth_mm),
            material,
            shear_modulus_override_pa: None,
        }
    }

    pub fn section_at(&self, x_m: f64) -> CrossSection {
        CrossSection::notched(
            self.radius_outer_m,
            self.radius_inner_m,
            self.depth_m.value(x_m),
        )
    }

    /// Depth derivative with respect to the tube's own arc length.
    pub fn depth_derivative(&self, x_m: f64) -> f64 {
        self.depth_m.derivative(x_m)
    }

    /// Derivative of the centroid offset `D` with respect to the tube's own arc
    /// length. This is the design shear `beta` of the paper.
    pub fn centroid_offset_derivative(&self, x_m: f64) -> f64 {
        let depth_derivative = self.depth_m.derivative(x_m);
        if depth_derivative.abs() < 1e-15 {
            return 0.0;
        }
        let depth = self.depth_m.value(x_m);
        let step = (1e-6 * self.radius_outer_m).max(1e-10);
        let plus = CrossSection::notched(self.radius_outer_m, self.radius_inner_m, depth + step)
            .centroid_offset_m;
        let minus = CrossSection::notched(self.radius_outer_m, self.radius_inner_m, depth - step)
            .centroid_offset_m;
        (plus - minus) / (2.0 * step) * depth_derivative
    }

    /// Mass per unit length, kg/m.
    pub fn mass_per_length(&self, x_m: f64) -> f64 {
        self.material.density_kg_m3 * self.section_at(x_m).area_m2
    }

    pub fn hooke_diagonal(&self, x_m: f64) -> [f64; 6] {
        self.section_at(x_m)
            .hooke_diagonal(&self.material, self.shear_modulus_override_pa)
    }
}

/// The leader (outer) and follower (inner) tubes of one section.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionTubes {
    pub leader: TubeProfile,
    pub follower: TubeProfile,
    /// Notched span length, m.
    pub length_m: f64,
    /// Number of notches in the span.
    pub segment_count: usize,
    /// Length of one notch and one tooth, m.
    pub notch_length_m: f64,
    pub uncut_length_m: f64,
}

impl SectionTubes {
    pub fn from_design(section: &crate::backend::SectionDesign) -> Self {
        let config = &section.config;
        let leader = TubeProfile::from_config(
            config,
            config.radius_outer as f64,
            config.outer_bore_radius() as f64,
            config.notch_depth_outer as f64,
            section.notch_depths_outer_mm.as_deref(),
            section.material,
        );
        let follower = TubeProfile::from_config(
            config,
            config.radius_inner as f64,
            config.inner_bore_radius() as f64,
            config.notch_depth_inner as f64,
            section.notch_depths_inner_mm.as_deref(),
            section.material,
        );
        let length_m = config.segments.max(1) as f64
            * (config.notch_length as f64 + config.uncut_length as f64)
            * 1e-3;

        Self {
            leader,
            follower,
            length_m,
            segment_count: config.segments.max(1),
            notch_length_m: config.notch_length as f64 * 1e-3,
            uncut_length_m: config.uncut_length as f64 * 1e-3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn close(a: f64, b: f64, tolerance: f64) -> bool {
        (a - b).abs() <= tolerance * (1.0 + a.abs().max(b.abs()))
    }

    #[test]
    fn zero_depth_is_a_full_annulus() {
        let section = CrossSection::notched(0.010, 0.007, 0.0);
        let area = std::f64::consts::PI * (0.010_f64.powi(2) - 0.007_f64.powi(2));
        let polar = std::f64::consts::FRAC_PI_4 * (0.010_f64.powi(4) - 0.007_f64.powi(4));

        assert!(close(section.area_m2, area, 1e-12));
        assert!(section.centroid_offset_m.abs() < 1e-15);
        assert!(close(section.iy_m4, polar, 1e-12));
        assert!(close(section.iz_m4, polar, 1e-12));
        assert!(close(section.ix_m4, 2.0 * polar, 1e-12));
    }

    #[test]
    fn deep_notch_removes_the_whole_bore() {
        let section = CrossSection::notched(0.010, 0.007, 0.018);
        let outer = DiskSegment::new(0.010, 0.008);

        assert!(close(section.area_m2, outer.area, 1e-12));
        assert!(close(section.centroid_offset_m, outer.y_centroid, 1e-12));
        assert!(close(section.iy_m4, outer.jy, 1e-12));
        assert!(close(
            section.iz_m4,
            outer.jz - outer.area * outer.y_centroid.powi(2),
            1e-12
        ));
    }

    #[test]
    fn half_notch_matches_numerical_integration() {
        let radius_outer = 0.010;
        let radius_inner = 0.007;
        let depth = 0.010;
        let alpha = depth - radius_outer;
        let section = CrossSection::notched(radius_outer, radius_inner, depth);

        let (area, centroid, jy, jz) = numerical_section(radius_outer, radius_inner, alpha, 700);

        assert!(
            close(section.area_m2, area, 2e-3),
            "area {} vs {}",
            section.area_m2,
            area
        );
        assert!(
            close(section.centroid_offset_m, centroid, 5e-3),
            "centroid {} vs {}",
            section.centroid_offset_m,
            centroid
        );
        assert!(
            close(section.iy_m4, jy, 1e-2),
            "jy {} vs {}",
            section.iy_m4,
            jy
        );
        assert!(close(section.iz_m4, jz - area * centroid.powi(2), 2e-2));
    }

    #[test]
    fn shallow_notch_matches_numerical_integration() {
        let radius_outer = 0.010;
        let radius_inner = 0.007;
        let depth = 0.002;
        let alpha = depth - radius_outer;
        let section = CrossSection::notched(radius_outer, radius_inner, depth);
        let (area, centroid, jy, jz) = numerical_section(radius_outer, radius_inner, alpha, 700);

        assert!(close(section.area_m2, area, 2e-3));
        assert!(close(section.centroid_offset_m, centroid, 2e-3));
        assert!(close(section.iy_m4, jy, 1e-2));
        assert!(close(section.iz_m4, jz - area * centroid.powi(2), 2e-2));
    }

    fn numerical_section(
        radius_outer: f64,
        radius_inner: f64,
        alpha: f64,
        bins: usize,
    ) -> (f64, f64, f64, f64) {
        let limit = radius_outer;
        let step = 2.0 * limit / bins as f64;
        let mut area = 0.0;
        let mut first_y = 0.0;
        let mut jy = 0.0;
        let mut jz = 0.0;

        for iy in 0..bins {
            let y = -limit + (iy as f64 + 0.5) * step;
            if y < alpha {
                continue;
            }
            for iz in 0..bins {
                let z = -limit + (iz as f64 + 0.5) * step;
                let r2 = y * y + z * z;
                if r2 > radius_outer * radius_outer {
                    continue;
                }
                // The remaining wall is (outer disk) minus (inner disk), so
                // cells inside the bore contribute exactly zero.
                let weight = if r2 <= radius_inner * radius_inner {
                    0.0
                } else {
                    1.0
                };
                let cell = step * step;
                area += weight * cell;
                first_y += weight * y * cell;
                jy += weight * z * z * cell;
                jz += weight * y * y * cell;
            }
        }

        (area, first_y / area, jy, jz)
    }

    #[test]
    fn hooke_matrix_is_positive_and_ordered() {
        let section = CrossSection::notched(0.010, 0.007, 0.004);
        let material = Material::PLA;
        let hooke = section.hooke_diagonal(&material, None);
        let g = material.shear_modulus_pa();
        let e = material.youngs_modulus_pa;

        assert!(close(hooke[0], g * section.ix_m4, 1e-12));
        assert!(close(hooke[1], e * section.iy_m4, 1e-12));
        assert!(close(hooke[2], e * section.iz_m4, 1e-12));
        assert!(close(hooke[3], e * section.area_m2, 1e-12));
        assert!(close(hooke[4], g * section.area_m2, 1e-12));
        assert!(hooke.iter().all(|value| *value > 0.0));
    }

    #[test]
    fn constant_profile_has_zero_derivative() {
        let profile = ScalarProfile::constant(0.003);
        assert!(close(profile.value(0.0), 0.003, 1e-15));
        assert!(close(profile.value(0.1), 0.003, 1e-15));
        assert_eq!(profile.derivative(0.05), 0.0);
    }

    #[test]
    fn spline_hits_samples_and_has_reasonable_derivative() {
        let profile = ScalarProfile::spline(vec![0.0, 0.1, 0.2, 0.3], vec![0.0, 1.0, 0.0, 1.0]);
        for (x, y) in [(0.0, 0.0), (0.1, 1.0), (0.2, 0.0), (0.3, 1.0)] {
            assert!(close(profile.value(x), y, 1e-12));
        }
        // Central difference agrees with the analytic derivative.
        let h = 1e-6;
        let x = 0.13;
        let numerical = (profile.value(x + h) - profile.value(x - h)) / (2.0 * h);
        assert!(close(profile.derivative(x), numerical, 1e-3));
    }

    #[test]
    fn per_notch_profile_is_resampled_and_interpolated() {
        let config = Config::new(10.0, 5.0, 3.0, 1.5, 5.0, 5.0, 5.0, 5.0, 4, 0.0);
        let profile = ScalarProfile::from_notch_samples(&config, Some(&[1.0, 2.0, 3.0, 4.0]), 0.0);
        // The section starts with an uncut tooth, matching the kinematic model:
        // notch `i` is centred at `i * pitch + uncut + notch / 2`.
        let pitch = 10.0e-3;
        let first = 5.0e-3 + 0.5 * 5.0e-3;
        assert!(close(profile.value(first), 1.0e-3, 1e-12));
        assert!(close(profile.value(first + 3.0 * pitch), 4.0e-3, 1e-12));
        // Linear input, so the natural spline is linear between samples.
        let mid = first + 0.5 * pitch;
        assert!(close(profile.value(mid), 1.5e-3, 1e-12));
    }

    #[test]
    fn section_tubes_use_config_bores_and_span() {
        let config = Config::new(10.0, 5.0, 3.0, 1.5, 5.0, 5.0, 4.0, 6.0, 3, 5.0);
        let design = crate::backend::SectionDesign::new(config, Material::PLA);
        let tubes = SectionTubes::from_design(&design);

        assert!(close(tubes.leader.radius_outer_m, 0.010, 1e-12));
        assert!(close(tubes.leader.radius_inner_m, 0.007, 1e-12));
        assert!(close(tubes.follower.radius_outer_m, 0.005, 1e-12));
        assert!(close(tubes.follower.radius_inner_m, 0.0035, 1e-12));
        assert!(close(tubes.length_m, 3.0 * (4.0 + 6.0) * 1e-3, 1e-12));
    }

    #[test]
    fn profile_clamps_outside_its_samples() {
        let profile = ScalarProfile::spline(vec![0.1, 0.2], vec![1.0, 2.0]);
        assert!(close(profile.value(0.0), 1.0, 1e-12));
        assert!(close(profile.value(1.0), 2.0, 1e-12));
        assert_eq!(profile.derivative(0.0), 0.0);
        assert_eq!(profile.derivative(1.0), 0.0);
    }
}
