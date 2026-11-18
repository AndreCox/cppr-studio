//! Minimal base-pose / limit definitions needed by the Cosserat WASM solver.

/// Translation limits for the movable base, in model units.
pub const MIN_BASE_TRANSLATION: f32 = -200.0;
pub const MAX_BASE_TRANSLATION: f32 = 200.0;
/// Rotation limits for the movable base, in degrees.
pub const MIN_BASE_ROTATION: f32 = -180.0;
pub const MAX_BASE_ROTATION: f32 = 180.0;

/// A 6-DOF pose for the robot base.
///
/// The transform is `translate(x, y, z) * Rz(yaw) * Ry(pitch) * Rx(roll)`,
/// i.e. yaw-pitch-roll with a world-space translation. It is applied before
/// the first module, so it moves the entire chain and its tip.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BasePose {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub roll_degrees: f32,
    pub pitch_degrees: f32,
    pub yaw_degrees: f32,
}

impl Default for BasePose {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
            roll_degrees: 0.0,
            pitch_degrees: 0.0,
            yaw_degrees: 0.0,
        }
    }
}

impl BasePose {
    /// Creates a base pose, clamping every component into its valid range.
    pub fn new(
        x: f32,
        y: f32,
        z: f32,
        roll_degrees: f32,
        pitch_degrees: f32,
        yaw_degrees: f32,
    ) -> Self {
        let mut pose = Self {
            x,
            y,
            z,
            roll_degrees,
            pitch_degrees,
            yaw_degrees,
        };
        pose.sanitize();
        pose
    }

    /// Clamps translations and rotations into their valid ranges.
    pub fn sanitize(&mut self) {
        self.x = self.x.clamp(MIN_BASE_TRANSLATION, MAX_BASE_TRANSLATION);
        self.y = self.y.clamp(MIN_BASE_TRANSLATION, MAX_BASE_TRANSLATION);
        self.z = self.z.clamp(MIN_BASE_TRANSLATION, MAX_BASE_TRANSLATION);
        self.roll_degrees = self
            .roll_degrees
            .clamp(MIN_BASE_ROTATION, MAX_BASE_ROTATION);
        self.pitch_degrees = self
            .pitch_degrees
            .clamp(MIN_BASE_ROTATION, MAX_BASE_ROTATION);
        self.yaw_degrees = self.yaw_degrees.clamp(MIN_BASE_ROTATION, MAX_BASE_ROTATION);
    }

}
