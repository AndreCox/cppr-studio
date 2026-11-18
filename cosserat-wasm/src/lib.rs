//! WebAssembly wrapper for the CPPR Cosserat rod solver.
//!
//! The UI sends a compact JSON design (one entry per section) and receives the
//! solved centerlines, section frame fields and solver diagnostics.

pub mod backend;
pub mod config;
pub mod robot;

use backend::cosserat::CosseratBackend;
use backend::{KinematicsBackend, Material, ModuleDesign, RobotDesign, RollDesign, SectionDesign};
use config::Config;
use robot::BasePose;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
struct MaterialInput {
    youngs_modulus_pa: f64,
    poisson_ratio: f64,
    density_kg_m3: f64,
}

#[derive(Debug, Deserialize)]
struct SectionInput {
    radius_outer_mm: f64,
    radius_inner_mm: f64,
    wall_outer_mm: f64,
    wall_inner_mm: f64,
    notch_length_mm: f64,
    uncut_length_mm: f64,
    notch_count: usize,
    end_length_mm: f64,
    #[serde(default)]
    notch_depths_outer_mm: Vec<f64>,
    #[serde(default)]
    notch_depths_inner_mm: Vec<f64>,
    push_pull_mm: f64,
    /// Roll applied at the base of this section before it bends, degrees.
    roll_before_deg: f64,
    material: MaterialInput,
}

#[derive(Debug, Deserialize)]
struct SolveInput {
    sections: Vec<SectionInput>,
    #[serde(default)]
    gravity_enabled: bool,
    #[serde(default)]
    gravity_m_s2: Option<[f64; 3]>,
    #[serde(default)]
    samples_per_notch: Option<usize>,
    #[serde(default)]
    curvature_modes: Option<usize>,
    #[serde(default)]
    torsion_modes: Option<usize>,
    #[serde(default)]
    planar: Option<bool>,
    #[serde(default)]
    centroid_scale: Option<f64>,
}

#[derive(Debug, Serialize)]
struct FrameOutput {
    s_mm: f64,
    pose: [[f64; 4]; 4],
    centroid_offset_mm: f64,
}

#[derive(Debug, Serialize)]
struct SectionOutput {
    centerline: Vec<[f64; 3]>,
    leader: Vec<FrameOutput>,
    follower: Vec<FrameOutput>,
}

/// Solve a complete CPPR chain. Returns a JSON string; throws on invalid input
/// or a solver failure.
#[wasm_bindgen]
pub fn solve_chain(input_json: &str) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    let input: SolveInput = serde_json::from_str(input_json)
        .map_err(|error| JsValue::from_str(&format!("invalid solver input: {error}")))?;

    let mut modules: Vec<ModuleDesign> = Vec::new();
    for section in &input.sections {
        if section.roll_before_deg.abs() > 1e-9 {
            modules.push(ModuleDesign::Roll(RollDesign {
                angle_deg: section.roll_before_deg,
            }));
        }
        let mean_outer = section.notch_depths_outer_mm.iter().sum::<f64>()
            / section.notch_depths_outer_mm.len().max(1) as f64;
        let mean_inner = section.notch_depths_inner_mm.iter().sum::<f64>()
            / section.notch_depths_inner_mm.len().max(1) as f64;
        let config = Config::new(
            section.radius_outer_mm as f32,
            section.radius_inner_mm as f32,
            section.wall_outer_mm as f32,
            section.wall_inner_mm as f32,
            if mean_outer.is_finite() { mean_outer as f32 } else { 0.0 },
            if mean_inner.is_finite() { mean_inner as f32 } else { 0.0 },
            section.notch_length_mm as f32,
            section.uncut_length_mm as f32,
            section.notch_count,
            section.end_length_mm as f32,
        );
        let material = Material {
            youngs_modulus_pa: section.material.youngs_modulus_pa,
            poisson_ratio: section.material.poisson_ratio,
            density_kg_m3: section.material.density_kg_m3,
        };
        let mut design = SectionDesign::new(config, material);
        design.q = section.push_pull_mm;
        if section.notch_depths_outer_mm.len() == section.notch_count {
            design.notch_depths_outer_mm = Some(section.notch_depths_outer_mm.clone());
        }
        if section.notch_depths_inner_mm.len() == section.notch_count {
            design.notch_depths_inner_mm = Some(section.notch_depths_inner_mm.clone());
        }
        modules.push(ModuleDesign::Section(design));
    }

    let mut design = RobotDesign::new(BasePose::default(), modules);
    if let Some(gravity) = input.gravity_m_s2 {
        design.gravity_world_m_s2 = gravity;
    }
    let mut settings = backend::cosserat::solver::SolverSettings::default();
    if let Some(samples) = input.samples_per_notch {
        settings.samples_per_notch = samples.clamp(2, 32);
    }
    if let Some(modes) = input.curvature_modes {
        settings.curvature_modes = modes.clamp(1, 8);
    }
    if let Some(modes) = input.torsion_modes {
        settings.torsion_modes = modes.clamp(0, 8);
    }
    if let Some(planar) = input.planar {
        settings.planar = planar;
    }
    if let Some(scale) = input.centroid_scale {
        settings.centroid_scale = scale.clamp(0.5, 2.0);
    }
    let mut solver = CosseratBackend::new(settings);
    let descriptors = solver.controls(&design);
    let mut controls = solver.default_controls(&design);
    controls.gravity_enabled = input.gravity_enabled;
    for (index, section) in input.sections.iter().enumerate() {
        let key = format!("section.{index}.push_pull");
        controls
            .set(&descriptors, &key, section.push_pull_mm)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    }

    let state = solver
        .solve(&design, &controls)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let sections: Vec<SectionOutput> = state
        .sections
        .iter()
        .map(|section| SectionOutput {
            centerline: section.centerline.clone(),
            leader: section
                .leader
                .samples
                .iter()
                .map(|sample| FrameOutput {
                    s_mm: sample.s_mm,
                    pose: sample.pose,
                    centroid_offset_mm: sample.centroid_offset_mm,
                })
                .collect(),
            follower: section
                .follower
                .samples
                .iter()
                .map(|sample| FrameOutput {
                    s_mm: sample.s_mm,
                    pose: sample.pose,
                    centroid_offset_mm: sample.centroid_offset_mm,
                })
                .collect(),
        })
        .collect();

    let output = serde_json::json!({
        "ok": true,
        "converged": state.diagnostics.converged,
        "iterations": state.diagnostics.iterations,
        "residual": state.diagnostics.residual,
        "solve_time_ms": state.diagnostics.solve_time_ms,
        "message": state.diagnostics.message,
        "centerline": state.centerline,
        "tip": state.tip,
        "sections": sections,
    });
    serde_json::to_string(&output)
        .map_err(|error| JsValue::from_str(&format!("could not serialize solver result: {error}")))
}
