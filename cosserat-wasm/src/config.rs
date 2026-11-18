pub(crate) const MIN_OUTER_RADIUS: f32 = 2.0;
pub(crate) const MAX_OUTER_RADIUS: f32 = 30.0;
pub(crate) const MIN_INNER_RADIUS: f32 = 0.5;
pub(crate) const MIN_RADIUS_GAP: f32 = 0.5;
pub(crate) const MIN_WALL_THICKNESS: f32 = 0.1;
pub(crate) const MIN_LENGTH: f32 = 0.1;
pub(crate) const MAX_LENGTH: f32 = 50.0;
pub(crate) const MIN_SEGMENTS: usize = 1;
pub(crate) const MAX_SEGMENTS: usize = 50;
pub(crate) const MIN_END_EFFECTOR_LENGTH: f32 = 0.0;

/// Application configuration settings.
#[derive(Debug, Clone)]
pub struct Config {
    // Add settings here.
    pub(crate) radius_outer: f32, // Outer radius of the outer tube.
    pub(crate) radius_inner: f32, // Outer radius of the inner tube.

    pub(crate) wall_thickness_outer: f32, // Wall thickness of the outer tube.
    pub(crate) wall_thickness_inner: f32, // Wall thickness of the inner tube.

    pub(crate) notch_depth_outer: f32, // Referred to a g_o in paper
    pub(crate) notch_depth_inner: f32, // Referred to a g_i in paper

    pub(crate) notch_length: f32, // Referred to as h in paper
    pub(crate) uncut_length: f32, // Referred to as c in paper

    pub(crate) segments: usize, // Number of segments, referred to as n in paper

    pub(crate) length_of_end_effector: f32, // Length of end effector, referred to as b in paper
}

impl Config {
    /// Creates a configuration with the tube radii, wall thicknesses, and
    /// notch parameters.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        radius_outer: f32,
        radius_inner: f32,
        wall_thickness_outer: f32,
        wall_thickness_inner: f32,
        notch_depth_outer: f32,
        notch_depth_inner: f32,
        notch_length: f32,
        uncut_length: f32,
        segments: usize,
        length_of_end_effector: f32,
    ) -> Self {
        Self {
            radius_outer,
            radius_inner,
            wall_thickness_outer,
            wall_thickness_inner,
            notch_depth_outer,
            notch_depth_inner,
            notch_length,
            uncut_length,
            segments,
            length_of_end_effector,
        }
    }

    /// Clamps every field into the range the UI and renderer can handle.
    pub fn sanitize(&mut self) {
        self.radius_outer = self.radius_outer.clamp(MIN_OUTER_RADIUS, MAX_OUTER_RADIUS);
        let max_inner = (self.radius_outer - MIN_RADIUS_GAP).max(MIN_INNER_RADIUS);
        self.radius_inner = self.radius_inner.clamp(MIN_INNER_RADIUS, max_inner);
        let max_outer_wall = (self.radius_outer - MIN_WALL_THICKNESS).max(MIN_WALL_THICKNESS);
        self.wall_thickness_outer = self
            .wall_thickness_outer
            .clamp(MIN_WALL_THICKNESS, max_outer_wall);
        let max_inner_wall = (self.radius_inner - MIN_WALL_THICKNESS).max(MIN_WALL_THICKNESS);
        self.wall_thickness_inner = self
            .wall_thickness_inner
            .clamp(MIN_WALL_THICKNESS, max_inner_wall);
        self.notch_depth_outer = self.notch_depth_outer.clamp(0.0, self.radius_outer * 2.0);
        self.notch_depth_inner = self.notch_depth_inner.clamp(0.0, self.radius_inner * 2.0);
        self.notch_length = self.notch_length.clamp(MIN_LENGTH, MAX_LENGTH);
        self.uncut_length = self.uncut_length.clamp(MIN_LENGTH, MAX_LENGTH);
        self.segments = self.segments.clamp(MIN_SEGMENTS, MAX_SEGMENTS);
        self.length_of_end_effector = self
            .length_of_end_effector
            .clamp(MIN_END_EFFECTOR_LENGTH, MAX_LENGTH);
    }

    /// Inner (bore) radius of the outer tube.
    pub(crate) fn outer_bore_radius(&self) -> f32 {
        (self.radius_outer - self.wall_thickness_outer).max(0.0)
    }

    /// Inner (bore) radius of the inner tube.
    pub(crate) fn inner_bore_radius(&self) -> f32 {
        (self.radius_inner - self.wall_thickness_inner).max(0.0)
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::new(
            10.0, 5.0, // tube outer radii
            3.0, 1.5, // wall thicknesses
            5.0, 5.0, // notch depths
            5.0, 5.0, // notch and uncut lengths
            10, 5.0, // segments and end-effector length
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_clamps_out_of_range_values() {
        let mut config = Config::new(1.0, 20.0, 0.1, 0.1, 50.0, 50.0, -5.0, 100.0, 0, -5.0);

        config.sanitize();

        assert!(config.radius_outer >= MIN_OUTER_RADIUS);
        assert!(config.radius_inner >= MIN_INNER_RADIUS);
        assert!(config.radius_inner <= config.radius_outer - MIN_RADIUS_GAP);
        assert!(config.wall_thickness_outer >= MIN_WALL_THICKNESS);
        assert!(config.wall_thickness_outer <= config.radius_outer - MIN_WALL_THICKNESS);
        assert!(config.wall_thickness_inner >= MIN_WALL_THICKNESS);
        assert!(config.wall_thickness_inner <= config.radius_inner - MIN_WALL_THICKNESS);
        assert!(config.notch_depth_outer <= config.radius_outer * 2.0);
        assert!(config.notch_depth_inner <= config.radius_inner * 2.0);
        assert!(config.notch_length >= MIN_LENGTH);
        assert!(config.notch_length <= MAX_LENGTH);
        assert!(config.uncut_length >= MIN_LENGTH);
        assert!(config.uncut_length <= MAX_LENGTH);
        assert!(config.segments >= MIN_SEGMENTS);
        assert!(config.segments <= MAX_SEGMENTS);
        assert!(config.length_of_end_effector >= MIN_END_EFFECTOR_LENGTH);
        assert!(config.length_of_end_effector <= MAX_LENGTH);
    }
}
