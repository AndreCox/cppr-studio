//! Pluggable kinematics backends.
//!
//! A backend turns a [`RobotDesign`] plus a [`ControlState`] into a
//! [`DeformedState`]. Each simulation model implements [`KinematicsBackend`], so
//! renderers, the fitter, and the live protocol can follow the active model
//! instead of calling `BendModel` directly. The Cosserat rod model in
//! [`cosserat`] is the first implementation; the piecewise-constant notch model
//! is adapted next.
//!
//! Public coordinates stay in millimetres and degrees. Backends convert to SI
//! internally. `DeformedState` is also in millimetres so it can be consumed by
//! the renderer without a unit conversion.

pub mod cosserat;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use nalgebra::{Isometry3, Matrix3, Rotation3, Translation3, UnitQuaternion};

use crate::config::Config;
use crate::robot::BasePose;

/// Bumped whenever a backend's numerical output changes.
pub const BACKEND_SOLVER_VERSION: u64 = 1;

/// Which simulation model produced a [`DeformedState`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BackendId {
    Kinematic,
    Cosserat,
}

impl BackendId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Kinematic => "kinematic",
            Self::Cosserat => "cosserat",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "kinematic" | "kinematics" | "bend" => Some(Self::Kinematic),
            "cosserat" | "rod" => Some(Self::Cosserat),
            _ => None,
        }
    }
}

/// Isotropic material properties in SI units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Material {
    pub youngs_modulus_pa: f64,
    pub poisson_ratio: f64,
    pub density_kg_m3: f64,
}

impl Material {
    /// PLA defaults used by the paper's 3D-printed prototypes.
    pub const PLA: Self = Self {
        youngs_modulus_pa: 5.39e9,
        poisson_ratio: 0.35,
        density_kg_m3: 1240.0,
    };

    /// Standard isotropic shear modulus `G = E / (2 (1 + nu))`.
    pub fn shear_modulus_pa(&self) -> f64 {
        self.youngs_modulus_pa / (2.0 * (1.0 + self.poisson_ratio))
    }
}

impl Default for Material {
    fn default() -> Self {
        Self::PLA
    }
}

/// A section's design: geometry plus material.
///
/// `notch_depths_*` are optional per-notch depths in millimetres, indexed from
/// the proximal to the distal end. When absent, the constant depth in `config`
/// is used. `notch_angles_deg` is reserved for helical centroid designs; the
/// current Cosserat solver treats every notch as axially aligned.
#[derive(Debug, Clone)]
pub struct SectionDesign {
    pub config: Config,
    pub material: Material,
    /// Initial kinematic control, millimetres of push/pull. The Cosserat
    /// backend ignores it and uses `section.k.push_pull` instead.
    pub q: f64,
    pub notch_depths_outer_mm: Option<Vec<f64>>,
    pub notch_depths_inner_mm: Option<Vec<f64>>,
    pub notch_angles_deg: Option<Vec<f64>>,
}

impl SectionDesign {
    pub fn new(config: Config, material: Material) -> Self {
        Self {
            config,
            material,
            q: 0.0,
            notch_depths_outer_mm: None,
            notch_depths_inner_mm: None,
            notch_angles_deg: None,
        }
    }

    pub fn with_q(mut self, q: f64) -> Self {
        self.q = q;
        self
    }
}

/// A rigid roll between two sections.
#[derive(Debug, Clone, Copy)]
pub struct RollDesign {
    pub angle_deg: f64,
}

/// One entry in the chain, in order.
#[derive(Debug, Clone)]
pub enum ModuleDesign {
    Section(SectionDesign),
    Roll(RollDesign),
}

/// Renderer- and solver-neutral description of a robot.
///
/// This is intentionally a snapshot: the backend never reaches back into the
/// live `Robot` while solving.
#[derive(Debug, Clone)]
pub struct RobotDesign {
    pub base: BasePose,
    pub modules: Vec<ModuleDesign>,
    /// Uniform gravitational acceleration in the world frame, m/s².
    pub gravity_world_m_s2: [f64; 3],
}

impl RobotDesign {
    pub fn new(base: BasePose, modules: Vec<ModuleDesign>) -> Self {
        Self {
            base,
            modules,
            gravity_world_m_s2: [0.0, 0.0, -9.81],
        }
    }

    /// Builds a design from the current live robot.
    ///
    /// The existing model does not store material properties, so every section
    /// gets [`Material::PLA`]. Callers that care can replace individual
    /// materials afterwards.
    pub fn sections(&self) -> impl Iterator<Item = &SectionDesign> {
        self.modules.iter().filter_map(|module| match module {
            ModuleDesign::Section(section) => Some(section),
            ModuleDesign::Roll(_) => None,
        })
    }

    pub fn section_count(&self) -> usize {
        self.sections().count()
    }

    pub fn roll_count(&self) -> usize {
        self.modules
            .iter()
            .filter(|module| matches!(module, ModuleDesign::Roll(_)))
            .count()
    }

    /// Hash of the geometry and materials, excluding the base pose, gravity,
    /// and roll angles. Used to decide whether a cached chain solver can be
    /// reused with a new control state.
    pub fn geometry_fingerprint(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        for module in &self.modules {
            match module {
                ModuleDesign::Section(section) => {
                    0_u8.hash(&mut hasher);
                    hash_config(&section.config, &mut hasher);
                    section
                        .material
                        .youngs_modulus_pa
                        .to_bits()
                        .hash(&mut hasher);
                    section.material.poisson_ratio.to_bits().hash(&mut hasher);
                    section.material.density_kg_m3.to_bits().hash(&mut hasher);
                    if let Some(depths) = &section.notch_depths_outer_mm {
                        depths.len().hash(&mut hasher);
                        for value in depths {
                            value.to_bits().hash(&mut hasher);
                        }
                    }
                    if let Some(depths) = &section.notch_depths_inner_mm {
                        depths.len().hash(&mut hasher);
                        for value in depths {
                            value.to_bits().hash(&mut hasher);
                        }
                    }
                }
                ModuleDesign::Roll(_) => 1_u8.hash(&mut hasher),
            }
        }
        hasher.finish()
    }
}

/// One editable degree of freedom exposed by a backend.
#[derive(Debug, Clone, PartialEq)]
pub struct ControlDescriptor {
    pub key: String,
    pub label: String,
    pub value: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub integer: bool,
}

impl ControlDescriptor {
    pub fn new(
        key: impl Into<String>,
        label: impl Into<String>,
        value: f64,
        min: f64,
        max: f64,
        step: f64,
    ) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            value,
            min,
            max,
            step,
            integer: false,
        }
    }
}

/// Values for every [`ControlDescriptor`], in the same order.
#[derive(Debug, Clone, PartialEq)]
pub struct ControlState {
    pub values: Vec<f64>,
    pub gravity_enabled: bool,
    /// World-frame wrench `[mx, my, mz, fx, fy, fz]` applied at the distal tip.
    /// Moments are N·m, forces are N.
    pub tip_load_world: [f64; 6],
}

impl ControlState {
    pub fn new(values: Vec<f64>) -> Self {
        Self {
            values,
            gravity_enabled: true,
            tip_load_world: [0.0; 6],
        }
    }

    pub fn from_descriptors(descriptors: &[ControlDescriptor]) -> Self {
        Self::new(descriptors.iter().map(|d| d.value).collect())
    }

    pub fn value(&self, descriptors: &[ControlDescriptor], key: &str) -> Option<f64> {
        descriptors
            .iter()
            .position(|descriptor| descriptor.key == key)
            .and_then(|index| self.values.get(index).copied())
    }

    pub fn set(
        &mut self,
        descriptors: &[ControlDescriptor],
        key: &str,
        value: f64,
    ) -> Result<(), SolveError> {
        let Some(index) = descriptors
            .iter()
            .position(|descriptor| descriptor.key == key)
        else {
            return Err(SolveError::UnknownControl(key.to_owned()));
        };
        let descriptor = &descriptors[index];
        let value = if descriptor.integer {
            value.round()
        } else {
            value
        };
        self.values[index] = value.clamp(descriptor.min, descriptor.max);
        Ok(())
    }

    pub fn clone_with_values(&self, values: Vec<f64>) -> Self {
        Self {
            values,
            gravity_enabled: self.gravity_enabled,
            tip_load_world: self.tip_load_world,
        }
    }
}

/// A pose sample along a tube's centroid line.
///
/// `s_mm` is the arc length from the section's proximal end. `pose` is the
/// world-frame transform of the cross-section frame, whose origin is the
/// centroid `G_i`, not the shared CPPR centerline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameSample {
    pub s_mm: f64,
    pub pose: [[f64; 4]; 4],
    /// Signed distance from the CPPR centerline `C` to this centroid along the
    /// local `+x` axis, millimetres. `C = G - d * R * e_x`.
    pub centroid_offset_mm: f64,
}

impl FrameSample {
    /// Centerline frame `g_C = g_G * Tx(-D)` for a mesh authored around `C`.
    pub fn centerline_pose(&self) -> [[f64; 4]; 4] {
        let mut pose = self.pose;
        for axis in 0..3 {
            pose[axis][3] -= pose[axis][0] * self.centroid_offset_mm;
        }
        pose
    }
}

/// The solved cross-section frame field of one tube.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameField {
    pub samples: Vec<FrameSample>,
}

impl FrameField {
    /// Interpolates the solved centroid field at `s_mm`. Beyond either end it
    /// extrapolates rigidly along the local `+z` tangent.
    pub fn sample_at(&self, s_mm: f64) -> Option<FrameSample> {
        let first = self.samples.first()?;
        let last = self.samples.last()?;

        if s_mm < first.s_mm {
            return Some(extrapolate(first, s_mm - first.s_mm));
        }
        if s_mm > last.s_mm {
            return Some(extrapolate(last, s_mm - last.s_mm));
        }
        if self.samples.len() == 1 {
            return Some(*first);
        }

        let upper = self
            .samples
            .partition_point(|sample| sample.s_mm <= s_mm)
            .min(self.samples.len() - 1)
            .max(1);
        let a = &self.samples[upper - 1];
        let b = &self.samples[upper];
        let span = b.s_mm - a.s_mm;
        let t = if span.abs() < f64::EPSILON {
            0.0
        } else {
            ((s_mm - a.s_mm) / span).clamp(0.0, 1.0)
        };

        let start = isometry_from_pose(&a.pose);
        let end = isometry_from_pose(&b.pose);
        let translation = start.translation.vector.lerp(&end.translation.vector, t);
        let rotation = start.rotation.slerp(&end.rotation, t);
        let pose = Isometry3::from_parts(Translation3::from(translation), rotation);

        Some(FrameSample {
            s_mm,
            pose: pose_to_array(&pose),
            centroid_offset_mm: a.centroid_offset_mm
                + (b.centroid_offset_mm - a.centroid_offset_mm) * t,
        })
    }
}

fn extrapolate(sample: &FrameSample, delta_mm: f64) -> FrameSample {
    let mut pose = sample.pose;
    for axis in 0..3 {
        pose[axis][3] += pose[axis][2] * delta_mm;
    }
    FrameSample {
        s_mm: sample.s_mm + delta_mm,
        pose,
        centroid_offset_mm: sample.centroid_offset_mm,
    }
}

fn isometry_from_pose(pose: &[[f64; 4]; 4]) -> Isometry3<f64> {
    let rotation = Matrix3::new(
        pose[0][0], pose[0][1], pose[0][2], //
        pose[1][0], pose[1][1], pose[1][2], //
        pose[2][0], pose[2][1], pose[2][2],
    );
    Isometry3::from_parts(
        Translation3::new(pose[0][3], pose[1][3], pose[2][3]),
        UnitQuaternion::from_rotation_matrix(&Rotation3::from_matrix_unchecked(rotation)),
    )
}

fn pose_to_array(pose: &Isometry3<f64>) -> [[f64; 4]; 4] {
    let rotation = pose.rotation.to_rotation_matrix();
    let translation = pose.translation.vector;
    let mut out = [[0.0; 4]; 4];
    for row in 0..3 {
        for column in 0..3 {
            out[row][column] = rotation[(row, column)];
        }
        out[row][3] = translation[row];
    }
    out[3][3] = 1.0;
    out
}

/// The deformed shape of one section.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionShape {
    pub section_index: usize,
    /// Outer tube / leader, origin at its centroid line.
    pub leader: FrameField,
    /// Inner tube / follower, origin at its centroid line.
    pub follower: FrameField,
    /// Shared CPPR centerline `C` in world coordinates, millimetres.
    pub centerline: Vec<[f64; 3]>,
}

/// Solver status, surfaced in the UI and the Python bindings.
#[derive(Debug, Clone, PartialEq)]
pub struct SolveDiagnostics {
    pub converged: bool,
    pub iterations: usize,
    pub residual: f64,
    pub solve_time_ms: f64,
    pub message: Option<String>,
}

impl Default for SolveDiagnostics {
    fn default() -> Self {
        Self {
            converged: true,
            iterations: 0,
            residual: 0.0,
            solve_time_ms: 0.0,
            message: None,
        }
    }
}

/// A complete solved configuration of the chain.
#[derive(Debug, Clone, PartialEq)]
pub struct DeformedState {
    pub backend: BackendId,
    pub solution_key: u64,
    pub sections: Vec<SectionShape>,
    /// Shared centerline of the whole chain in world coordinates, millimetres.
    pub centerline: Vec<[f64; 3]>,
    pub tip: [f64; 3],
    /// Rigid module start frames, for debugging and the legacy renderer.
    pub module_poses: Vec<[[f64; 4]; 4]>,
    pub diagnostics: SolveDiagnostics,
}

impl DeformedState {
    /// Stable hash of the backend, design, controls, and solver version.
    pub fn make_solution_key(
        backend: BackendId,
        design: &RobotDesign,
        controls: &ControlState,
        solver_version: u64,
    ) -> u64 {
        let mut hasher = DefaultHasher::new();
        backend.hash(&mut hasher);
        solver_version.hash(&mut hasher);
        design.base.x.to_bits().hash(&mut hasher);
        design.base.y.to_bits().hash(&mut hasher);
        design.base.z.to_bits().hash(&mut hasher);
        design.base.roll_degrees.to_bits().hash(&mut hasher);
        design.base.pitch_degrees.to_bits().hash(&mut hasher);
        design.base.yaw_degrees.to_bits().hash(&mut hasher);
        for value in design.gravity_world_m_s2 {
            value.to_bits().hash(&mut hasher);
        }
        for module in &design.modules {
            match module {
                ModuleDesign::Section(section) => {
                    0_u8.hash(&mut hasher);
                    hash_config(&section.config, &mut hasher);
                    section
                        .material
                        .youngs_modulus_pa
                        .to_bits()
                        .hash(&mut hasher);
                    section.material.poisson_ratio.to_bits().hash(&mut hasher);
                    section.material.density_kg_m3.to_bits().hash(&mut hasher);
                    section.q.to_bits().hash(&mut hasher);
                    if let Some(depths) = &section.notch_depths_outer_mm {
                        depths.len().hash(&mut hasher);
                        for value in depths {
                            value.to_bits().hash(&mut hasher);
                        }
                    }
                    if let Some(depths) = &section.notch_depths_inner_mm {
                        depths.len().hash(&mut hasher);
                        for value in depths {
                            value.to_bits().hash(&mut hasher);
                        }
                    }
                }
                ModuleDesign::Roll(roll) => {
                    1_u8.hash(&mut hasher);
                    roll.angle_deg.to_bits().hash(&mut hasher);
                }
            }
        }
        for value in &controls.values {
            value.to_bits().hash(&mut hasher);
        }
        controls.gravity_enabled.hash(&mut hasher);
        for value in controls.tip_load_world {
            value.to_bits().hash(&mut hasher);
        }
        hasher.finish()
    }
}

fn hash_config(config: &Config, hasher: &mut DefaultHasher) {
    config.radius_outer.to_bits().hash(hasher);
    config.radius_inner.to_bits().hash(hasher);
    config.wall_thickness_outer.to_bits().hash(hasher);
    config.wall_thickness_inner.to_bits().hash(hasher);
    config.notch_depth_outer.to_bits().hash(hasher);
    config.notch_depth_inner.to_bits().hash(hasher);
    config.notch_length.to_bits().hash(hasher);
    config.uncut_length.to_bits().hash(hasher);
    config.segments.hash(hasher);
    config.length_of_end_effector.to_bits().hash(hasher);
}

/// Errors a backend can return. A failed solve never replaces the last good
/// state in the app.
#[derive(Debug, Clone, PartialEq)]
pub enum SolveError {
    InvalidDesign(String),
    UnknownControl(String),
    NotConverged { residual: f64, iterations: usize },
    Singular(String),
}

impl std::fmt::Display for SolveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidDesign(message) => write!(formatter, "invalid design: {message}"),
            Self::UnknownControl(key) => write!(formatter, "unknown control: {key}"),
            Self::NotConverged {
                residual,
                iterations,
            } => write!(
                formatter,
                "solver did not converge after {iterations} iterations (residual {residual:.3e})"
            ),
            Self::Singular(message) => write!(formatter, "singular system: {message}"),
        }
    }
}

impl std::error::Error for SolveError {}

/// The seam every simulation model implements.
pub trait KinematicsBackend: Send + Sync {
    fn id(&self) -> BackendId;

    /// Controls this backend exposes for `design`, in a stable order.
    fn controls(&self, design: &RobotDesign) -> Vec<ControlDescriptor>;

    /// Neutral control values for `design`.
    fn default_controls(&self, design: &RobotDesign) -> ControlState;

    /// Solves one configuration. Implementations may cache or warm-start
    /// internally; callers treat this as a pure function of design + controls.
    fn solve(
        &mut self,
        design: &RobotDesign,
        controls: &ControlState,
    ) -> Result<DeformedState, SolveError>;
}

/// Flattens a 4×4 transform into a row-major array for the presentation layer.
pub fn matrix4_to_array(matrix: &nalgebra::Matrix4<f64>) -> [[f64; 4]; 4] {
    let mut out = [[0.0; 4]; 4];
    for row in 0..4 {
        for column in 0..4 {
            out[row][column] = matrix[(row, column)];
        }
    }
    out
}
