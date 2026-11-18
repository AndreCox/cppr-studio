//! Serial-chain assembly for the 3D Cosserat CPR model.
//!
//! Each section is treated as its own two-tube CPPR.
//! Sections are joined by a rigid connector and an optional roll, exactly like
//! the existing module chain: `g_next = g_tip * T(connector) * Rx(roll)`.
//!
//! Unlike the paper's single-CPPR algorithm, the chain has two boundary
//! conditions at every interface: the next section's base pose comes from the
//! previous section's solved shape, while the previous section's tip load is the
//! next section's base reaction. The chain is therefore solved as one assembled
//! nonlinear system. Unknowns are the Ritz coefficients of every section, the
//! push/pull tension `T+` of every follower, and the world-frame wrench at every
//! interface. Equations are the section balances `Qint + Qext = 0`, the
//! prescribed displacements `Delta a`, and wrench continuity at each interface.
//!
//! Internal coordinates are metres, radians, newtons, and newton-metres.

use nalgebra::{DMatrix, DVector, Rotation3, Vector3, Vector6};

use crate::backend::cosserat::cross_section::SectionTubes;
use crate::backend::cosserat::kinematics::{Pose, base_pose_from_public};
use crate::backend::cosserat::solver::{SectionEvaluation, SectionSolver, SolverSettings};
use crate::backend::{ModuleDesign, RobotDesign, SolveError};

/// One section plus the rigid link that follows it.
#[derive(Debug, Clone)]
pub struct ChainSection {
    pub solver: SectionSolver,
    /// Indices into the roll-angle vector that act at this section's proximal
    /// end. Several rolls in a row compose about the same axis.
    pub pre_roll_indices: Vec<usize>,
    /// Rigid length after this section, m. For the last section this is the end
    /// effector; for earlier sections it is the inter-section connector.
    pub connector_m: f64,
    /// Index of this section in `RobotDesign.modules`.
    pub module_index: usize,
}

/// The assembled chain.
#[derive(Debug, Clone)]
pub struct ChainSolver {
    pub sections: Vec<ChainSection>,
    /// One entry per design module: `Some(section)` or `None` for a roll.
    pub module_sections: Vec<Option<usize>>,
    pub roll_count: usize,
    pub settings: SolverSettings,
    last_solution: Option<Vec<f64>>,
    /// Inputs that produced `last_solution`, used to decide whether a warm
    /// start is worth trying.
    last_inputs: Option<SolveInputs>,
    /// Number of `solve_target` attempts used by the most recent `solve`.
    pub last_attempts: usize,
}

#[derive(Debug, Clone)]
struct SolveInputs {
    targets_m: Vec<f64>,
    roll_rad: Vec<f64>,
    base_pose: Pose,
}

/// Solved configuration of the complete chain.
#[derive(Debug, Clone)]
pub struct ChainSolution {
    pub sections: Vec<SectionEvaluation>,
    /// Centroid frame `g_i(0)` of every section, in the paper's world frame.
    pub section_base_poses: Vec<Pose>,
    /// Shared centerline pose `C` at the base of every section.
    pub section_centerline_bases: Vec<Pose>,
    /// One pose per design module, for the legacy rigid debug view.
    pub module_poses: Vec<Pose>,
    pub base_pose: Pose,
    /// Shared centerline tip after the last connector, in the paper frame.
    pub tip_pose: Pose,
    pub modal: Vec<Vec<f64>>,
    pub t_plus_n: Vec<f64>,
    pub interface_wrenches_world: Vec<Vector6<f64>>,
    pub converged: bool,
    pub iterations: usize,
    pub residual_norm: f64,
}

#[derive(Clone)]
struct ChainEvaluation {
    sections: Vec<SectionEvaluation>,
    base_poses: Vec<Pose>,
    centerline_bases: Vec<Pose>,
    residual: Vec<f64>,
    residual_norm: f64,
}

struct ChainAttempt {
    evaluation: ChainEvaluation,
    x: Vec<f64>,
    converged: bool,
    iterations: usize,
}

impl ChainSolver {
    /// Builds a chain from a snapshot design.
    pub fn new(design: &RobotDesign, settings: SolverSettings) -> Result<Self, SolveError> {
        let mut sections = Vec::new();
        let mut module_sections = Vec::new();
        let mut pending_rolls: Vec<usize> = Vec::new();
        let mut roll_count = 0;

        for (module_index, module) in design.modules.iter().enumerate() {
            match module {
                ModuleDesign::Roll(_) => {
                    pending_rolls.push(roll_count);
                    roll_count += 1;
                    module_sections.push(None);
                }
                ModuleDesign::Section(section) => {
                    let tubes = SectionTubes::from_design(section);
                    if tubes.length_m <= 1e-9 {
                        return Err(SolveError::InvalidDesign(
                            "section has zero notched length".to_owned(),
                        ));
                    }
                    let solver = SectionSolver::new(tubes, settings.clone());
                    let ordinal = sections.len();
                    sections.push(ChainSection {
                        solver,
                        pre_roll_indices: std::mem::take(&mut pending_rolls),
                        connector_m: (section.config.length_of_end_effector.max(0.0) as f64) * 1e-3,
                        module_index,
                    });
                    module_sections.push(Some(ordinal));
                }
            }
        }

        if sections.is_empty() {
            return Err(SolveError::InvalidDesign(
                "the chain needs at least one section".to_owned(),
            ));
        }

        Ok(Self {
            sections,
            module_sections,
            roll_count,
            settings,
            last_solution: None,
            last_inputs: None,
            last_attempts: 0,
        })
    }

    pub fn section_count(&self) -> usize {
        self.sections.len()
    }

    pub fn coefficient_count(&self) -> usize {
        self.sections
            .iter()
            .map(|section| section.solver.coefficient_count())
            .sum()
    }

    pub fn unknown_count(&self) -> usize {
        self.coefficient_count() + self.section_count() + 6 * self.section_count().saturating_sub(1)
    }

    pub fn zero_unknowns(&self) -> Vec<f64> {
        vec![0.0; self.unknown_count()]
    }

    /// Solves the chain for prescribed push/pull displacements, in metres.
    ///
    /// `base_pose` is the shared centerline pose at the proximal end of the
    /// first section. `roll_rad` has one entry per roll module, in chain order.
    pub fn solve(
        &mut self,
        base_pose: &Pose,
        roll_rad: &[f64],
        targets_m: &[f64],
        tip_load_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> Result<ChainSolution, SolveError> {
        if roll_rad.len() != self.roll_count {
            return Err(SolveError::InvalidDesign(format!(
                "expected {} roll angles, got {}",
                self.roll_count,
                roll_rad.len()
            )));
        }
        if targets_m.len() != self.section_count() {
            return Err(SolveError::InvalidDesign(format!(
                "expected {} push/pull targets, got {}",
                self.section_count(),
                targets_m.len()
            )));
        }

        let warm = match &self.last_solution {
            Some(values) if values.len() == self.unknown_count() => values.clone(),
            _ => self.zero_unknowns(),
        };

        // A warm start is only useful when the controls moved a little. After a
        // large jump the previous shape sends the LM down the wrong valley and
        // it burns a full iteration budget before the continuation retries from
        // zero anyway.
        let large_change = self.last_inputs.as_ref().is_some_and(|previous| {
            inputs_changed_a_lot(
                previous,
                targets_m,
                roll_rad,
                base_pose,
                self.settings.chain_warm_target_change_m,
            )
        });

        let mut attempts = 0;
        let mut attempt = None;
        if !large_change {
            let warm_attempt = self.solve_target(
                warm,
                base_pose,
                roll_rad,
                targets_m,
                tip_load_world,
                gravity_world,
            );
            attempts += 1;
            if warm_attempt.converged {
                attempt = Some(warm_attempt);
            }
        }

        // Displacement actuation is strongly nonlinear at large values. If the
        // warm start misses (or was skipped), ramp the targets from zero.
        let mut attempt = match attempt {
            Some(attempt) => attempt,
            None => {
                let mut current = self.zero_unknowns();
                let mut last = None;
                for fraction in [0.25, 0.5, 0.75, 1.0] {
                    let stepped: Vec<f64> =
                        targets_m.iter().map(|value| value * fraction).collect();
                    let stepped_attempt = self.solve_target(
                        current,
                        base_pose,
                        roll_rad,
                        &stepped,
                        tip_load_world,
                        gravity_world,
                    );
                    attempts += 1;
                    current = stepped_attempt.x.clone();
                    let converged = stepped_attempt.converged;
                    last = Some(stepped_attempt);
                    if !converged {
                        break;
                    }
                }
                last.expect("the continuation always runs at least one stage")
            }
        };

        // Broyden updates occasionally drift on the hardest loads. Retry the
        // whole continuation with a freshly rebuilt finite-difference Jacobian
        // every iteration; this is the original, robust path and only runs when
        // the fast path missed.
        if !attempt.converged {
            // First retry the full target from zero with the robust Jacobian:
            // for moderate loads this is the original single-shot path.
            let full = self.solve_target_with_jacobian(
                self.zero_unknowns(),
                base_pose,
                roll_rad,
                targets_m,
                tip_load_world,
                gravity_world,
                false,
                self.settings.lm_initial_damping,
            );
            attempts += 1;
            let mut robust = if full.converged { Some(full) } else { None };

            if robust.is_none() {
                let mut current = self.zero_unknowns();
                for fraction in [0.25, 0.5, 0.75, 1.0] {
                    let stepped: Vec<f64> =
                        targets_m.iter().map(|value| value * fraction).collect();
                    let stepped_attempt = self.solve_target_with_jacobian(
                        current,
                        base_pose,
                        roll_rad,
                        &stepped,
                        tip_load_world,
                        gravity_world,
                        false,
                        self.settings.lm_initial_damping,
                    );
                    attempts += 1;
                    current = stepped_attempt.x.clone();
                    let converged = stepped_attempt.converged;
                    robust = Some(stepped_attempt);
                    if !converged {
                        break;
                    }
                }
            }
            if let Some(robust) = robust {
                if robust.evaluation.residual_norm < attempt.evaluation.residual_norm {
                    attempt = robust;
                }
            }
        }
        self.last_attempts = attempts;
        self.last_inputs = Some(SolveInputs {
            targets_m: targets_m.to_vec(),
            roll_rad: roll_rad.to_vec(),
            base_pose: *base_pose,
        });

        if attempt.converged {
            self.last_solution = Some(attempt.x.clone());
        }

        self.finish(attempt, base_pose, roll_rad)
    }

    fn finish(
        &self,
        attempt: ChainAttempt,
        base_pose: &Pose,
        _roll_rad: &[f64],
    ) -> Result<ChainSolution, SolveError> {
        let evaluation = attempt.evaluation;
        let mut module_poses = Vec::with_capacity(self.module_sections.len());
        let mut link = *base_pose;
        for module in &self.module_sections {
            match *module {
                None => module_poses.push(link),
                Some(index) => {
                    module_poses.push(evaluation.base_poses[index]);
                    let tip = evaluation.sections[index].leader_tip;
                    let d_tip = self.sections[index]
                        .solver
                        .leader_offset_at(self.sections[index].solver.length_m());
                    let centerline_tip = tip.compose(&translate_y(-d_tip.0));
                    link = centerline_tip.compose(&translate_x(self.sections[index].connector_m));
                }
            }
        }

        let last = evaluation.sections.len() - 1;
        let d_tip = self.sections[last]
            .solver
            .leader_offset_at(self.sections[last].solver.length_m());
        let tip_pose = evaluation.sections[last]
            .leader_tip
            .compose(&translate_y(-d_tip.0))
            .compose(&translate_x(self.sections[last].connector_m));

        let mut modal = Vec::with_capacity(evaluation.sections.len());
        let mut t_plus_n = Vec::with_capacity(evaluation.sections.len());
        for section in &evaluation.sections {
            modal.push(section.q.clone());
            t_plus_n.push(section.t_plus_n);
        }
        let (_, _, interface_wrenches_world) = unpack(&attempt.x, self);

        Ok(ChainSolution {
            sections: evaluation.sections,
            section_base_poses: evaluation.base_poses,
            section_centerline_bases: evaluation.centerline_bases,
            module_poses,
            base_pose: *base_pose,
            tip_pose,
            modal,
            t_plus_n,
            interface_wrenches_world,
            converged: attempt.converged,
            iterations: attempt.iterations,
            residual_norm: evaluation.residual_norm,
        })
    }

    fn solve_target(
        &self,
        x0: Vec<f64>,
        base_pose: &Pose,
        roll_rad: &[f64],
        targets_m: &[f64],
        tip_load_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> ChainAttempt {
        self.solve_target_with_jacobian(
            x0,
            base_pose,
            roll_rad,
            targets_m,
            tip_load_world,
            gravity_world,
            self.settings.chain_broyden,
            self.settings.chain_lm_initial_damping,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn solve_target_with_jacobian(
        &self,
        x0: Vec<f64>,
        base_pose: &Pose,
        roll_rad: &[f64],
        targets_m: &[f64],
        tip_load_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
        use_broyden: bool,
        initial_damping: f64,
    ) -> ChainAttempt {
        let n = self.unknown_count();
        let mut x = if x0.len() == n {
            x0
        } else {
            self.zero_unknowns()
        };
        let mut evaluation = self.evaluate_chain(
            &x,
            base_pose,
            roll_rad,
            targets_m,
            tip_load_world,
            gravity_world,
        );
        let tolerance = self.settings.residual_tolerance.max(1e-10);
        let mut damping = initial_damping.max(1e-12);
        let mut best = evaluation.clone();
        let mut best_x = x.clone();
        let mut best_norm = evaluation.residual_norm;
        let mut iterations = 0;
        let mut jacobian: Option<DMatrix<f64>> = None;
        let mut since_refresh = usize::MAX / 2;
        let refresh_interval = self.settings.chain_jacobian_refresh.max(1);

        for iteration in 0..self.settings.max_iterations.max(1) {
            iterations = iteration + 1;
            if evaluation.residual_norm <= tolerance {
                break;
            }

            let base_residual = DVector::from_column_slice(&evaluation.residual);

            if jacobian.is_none() || !use_broyden || since_refresh >= refresh_interval {
                jacobian = Some(self.finite_difference_jacobian(
                    &x,
                    &evaluation,
                    base_pose,
                    roll_rad,
                    targets_m,
                    tip_load_world,
                    gravity_world,
                ));
                since_refresh = 0;
            }

            let (normal_base, gradient) = {
                let j = jacobian.as_ref().expect("Jacobian was just rebuilt");
                (j.transpose() * j, j.transpose() * &base_residual)
            };

            let mut accepted_step: Option<DVector<f64>> = None;
            for _ in 0..10 {
                let mut normal = normal_base.clone();
                for index in 0..n {
                    normal[(index, index)] +=
                        damping * normal_base[(index, index)].abs().max(1e-12) + 1e-15;
                }
                let Some(step) = normal.lu().solve(&(-gradient.clone())) else {
                    damping = (damping * 10.0).min(1e12);
                    continue;
                };
                let candidate: Vec<f64> = x
                    .iter()
                    .zip(step.iter())
                    .map(|(value, delta)| value + delta)
                    .collect();
                let candidate_eval = self.evaluate_chain(
                    &candidate,
                    base_pose,
                    roll_rad,
                    targets_m,
                    tip_load_world,
                    gravity_world,
                );
                if candidate_eval.residual_norm < evaluation.residual_norm {
                    let new_residual = DVector::from_column_slice(&candidate_eval.residual);
                    if use_broyden {
                        let predicted = {
                            let j = jacobian.as_ref().expect("Jacobian was just rebuilt");
                            j * &step
                        };
                        let difference = &new_residual - &base_residual - predicted;
                        let denominator = step.dot(&step);
                        if denominator > 1e-30 {
                            let j = jacobian.as_mut().expect("Jacobian was just rebuilt");
                            *j += difference * step.transpose() / denominator;
                        }
                    }
                    x = candidate;
                    evaluation = candidate_eval;
                    accepted_step = Some(step);
                    damping = (damping * 0.3).max(1e-12);
                    if use_broyden {
                        since_refresh += 1;
                    }
                    break;
                }
                damping = (damping * 10.0).min(1e12);
            }

            let accepted = accepted_step.is_some();
            if evaluation.residual_norm < best_norm {
                best_norm = evaluation.residual_norm;
                best_x = x.clone();
                best = evaluation.clone();
            }
            if !accepted {
                break;
            }
        }

        if evaluation.residual_norm < best_norm {
            best_norm = evaluation.residual_norm;
            best_x = x;
            best = evaluation;
        }

        let converged = best_norm <= tolerance;
        ChainAttempt {
            evaluation: best,
            x: best_x,
            converged,
            iterations,
        }
    }

    /// Finite-difference Jacobian of the assembled chain residual.
    ///
    /// Every column is an independent full chain evaluation; they dominate the
    /// solve, so they run in parallel. The results are written back in column
    /// order.
    #[allow(clippy::too_many_arguments)]
    fn finite_difference_jacobian(
        &self,
        x: &[f64],
        evaluation: &ChainEvaluation,
        base_pose: &Pose,
        roll_rad: &[f64],
        targets_m: &[f64],
        tip_load_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> DMatrix<f64> {
        let n = x.len();
        let m = evaluation.residual.len();
        let columns: Vec<(usize, Vec<f64>)> = (0..n)
            .into_iter()
            .map(|column| {
                let step =
                    self.settings.finite_difference_step.max(1e-12) * (1.0 + x[column].abs());
                let mut perturbed = x.to_vec();
                perturbed[column] += step;
                let plus = self.evaluate_chain(
                    &perturbed,
                    base_pose,
                    roll_rad,
                    targets_m,
                    tip_load_world,
                    gravity_world,
                );
                let difference: Vec<f64> = plus
                    .residual
                    .iter()
                    .zip(&evaluation.residual)
                    .map(|(plus, base)| (plus - base) / step)
                    .collect();
                (column, difference)
            })
            .collect();

        let mut jacobian = DMatrix::zeros(m, n);
        for (column, difference) in columns {
            for row in 0..m {
                jacobian[(row, column)] = difference[row];
            }
        }
        jacobian
    }

    fn evaluate_chain(
        &self,
        x: &[f64],
        base_pose: &Pose,
        roll_rad: &[f64],
        targets_m: &[f64],
        tip_load_world: &Vector6<f64>,
        gravity_world: &Vector3<f64>,
    ) -> ChainEvaluation {
        let (modal, t_plus, interface) = unpack(x, self);
        let count = self.sections.len();
        let mut sections = Vec::with_capacity(count);
        let mut base_poses = Vec::with_capacity(count);
        let mut centerline_bases = Vec::with_capacity(count);

        let mut centerline_link = *base_pose;
        for index in 0..count {
            let section = &self.sections[index];
            let roll_angle: f64 = section
                .pre_roll_indices
                .iter()
                .filter_map(|roll| roll_rad.get(*roll))
                .sum();
            let centerline_base = centerline_link.compose(&roll_pose(roll_angle));
            let d_base = section.solver.leader_offset_at(0.0).0;
            let base = centerline_base.compose(&translate_y(d_base));

            let tip_wrench = if index + 1 < count {
                interface[index]
            } else {
                *tip_load_world
            };
            let evaluation = section.solver.evaluate(
                &base,
                &modal[index],
                t_plus[index],
                &tip_wrench,
                gravity_world,
            );

            let d_tip = section.solver.leader_offset_at(section.solver.length_m()).0;
            let centerline_tip = evaluation.leader_tip.compose(&translate_y(-d_tip));
            centerline_link = centerline_tip.compose(&translate_x(section.connector_m));

            base_poses.push(base);
            centerline_bases.push(centerline_base);
            sections.push(evaluation);
        }

        let mut residual = Vec::with_capacity(self.unknown_count());
        for (index, evaluation) in sections.iter().enumerate() {
            residual.extend_from_slice(&evaluation.residual);
            residual.push(evaluation.delta_a_m - targets_m[index]);
        }
        for index in 0..count.saturating_sub(1) {
            // Interface wrenches are expressed in world orientation at the
            // preceding section's leader tip point.
            //
            // `g_tip_base` is the pose of the next centroid base in that tip
            // body frame. Re-attaching world orientation at the same point
            // adds the tip rotation with no translation.
            let tip = sections[index].leader_tip;
            let g_tip_base = tip.inverse().compose(&base_poses[index + 1]);
            let g_world_base = Pose::new(tip.rotation, Vector3::zeros()).compose(&g_tip_base);
            let back_reaction = g_world_base.wrench_from_child(&sections[index + 1].base_reaction);
            let difference = interface[index] - back_reaction;
            residual.extend_from_slice(difference.as_slice());
        }

        let residual_norm = residual
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt();
        ChainEvaluation {
            sections,
            base_poses,
            centerline_bases,
            residual,
            residual_norm,
        }
    }
}

/// Whether the controls moved far enough that the previous shape is a poor
/// warm start. The thresholds are deliberately loose: a skipped warm start
/// costs one cheap continuation stage, while a bad one can cost a full
/// nonlinear solve.
fn inputs_changed_a_lot(
    previous: &SolveInputs,
    targets_m: &[f64],
    roll_rad: &[f64],
    base_pose: &Pose,
    target_threshold_m: f64,
) -> bool {
    let target_change = previous
        .targets_m
        .iter()
        .zip(targets_m)
        .map(|(old, new)| (new - old).abs())
        .fold(0.0, f64::max);
    if target_change > target_threshold_m {
        return true;
    }

    let roll_change = previous
        .roll_rad
        .iter()
        .zip(roll_rad)
        .map(|(old, new)| {
            ((new - old + std::f64::consts::PI).rem_euclid(2.0 * std::f64::consts::PI)
                - std::f64::consts::PI)
                .abs()
        })
        .fold(0.0, f64::max);
    if roll_change > 0.09 {
        return true;
    }

    if (base_pose.translation - previous.base_pose.translation).norm() > 1e-3 {
        return true;
    }

    let relative = previous.base_pose.rotation.transpose() * base_pose.rotation;
    let cosine = ((relative[(0, 0)] + relative[(1, 1)] + relative[(2, 2)]) - 1.0) / 2.0;
    cosine.clamp(-1.0, 1.0).acos() > 0.05
}

fn unpack(x: &[f64], chain: &ChainSolver) -> (Vec<Vec<f64>>, Vec<f64>, Vec<Vector6<f64>>) {
    let mut modal = Vec::with_capacity(chain.sections.len());
    let mut offset = 0;
    for section in &chain.sections {
        let count = section.solver.coefficient_count();
        modal.push(x[offset..offset + count].to_vec());
        offset += count;
    }
    let t_plus = x[offset..offset + chain.sections.len()].to_vec();
    offset += chain.sections.len();
    let mut interface = Vec::with_capacity(chain.sections.len().saturating_sub(1));
    for _ in 0..chain.sections.len().saturating_sub(1) {
        interface.push(Vector6::from_column_slice(&x[offset..offset + 6]));
        offset += 6;
    }
    (modal, t_plus, interface)
}

/// Builds the public chain from a design and resolved control values.
pub fn base_pose_for_design(design: &RobotDesign) -> Pose {
    base_pose_from_public(
        design.base.x as f64,
        design.base.y as f64,
        design.base.z as f64,
        design.base.roll_degrees as f64,
        design.base.pitch_degrees as f64,
        design.base.yaw_degrees as f64,
    )
}

fn roll_pose(angle_rad: f64) -> Pose {
    Pose::new(
        Rotation3::from_axis_angle(&Vector3::x_axis(), angle_rad),
        Vector3::zeros(),
    )
}

fn translate_x(distance: f64) -> Pose {
    Pose::new(Rotation3::identity(), Vector3::new(distance, 0.0, 0.0))
}

fn translate_y(distance: f64) -> Pose {
    Pose::new(Rotation3::identity(), Vector3::new(0.0, distance, 0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::cosserat::solver::SolverSettings;
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

    fn two_section_design() -> RobotDesign {
        RobotDesign::new(
            BasePose::default(),
            vec![
                ModuleDesign::Roll(RollDesign { angle_deg: 0.0 }),
                ModuleDesign::Section(SectionDesign::new(r1_config(), Material::PLA)),
                ModuleDesign::Roll(RollDesign { angle_deg: 90.0 }),
                ModuleDesign::Section(SectionDesign::new(r1_config(), Material::PLA)),
            ],
        )
    }

    fn settings(planar: bool) -> SolverSettings {
        SolverSettings {
            curvature_modes: 3,
            torsion_modes: 2,
            planar,
            samples_per_notch: 3,
            max_iterations: 25,
            residual_tolerance: 1e-6,
            ..Default::default()
        }
    }

    #[test]
    fn chain_layout_maps_rolls_to_sections() {
        let design = two_section_design();
        let chain = ChainSolver::new(&design, settings(false)).unwrap();
        assert_eq!(chain.section_count(), 2);
        assert_eq!(chain.roll_count, 2);
        assert_eq!(chain.sections[0].pre_roll_indices, vec![0]);
        assert_eq!(chain.sections[1].pre_roll_indices, vec![1]);
        assert_eq!(chain.unknown_count(), 2 * 11 + 2 + 6);
    }

    #[test]
    fn zero_actuation_without_gravity_is_straight() {
        let design = single_design();
        let mut chain = ChainSolver::new(&design, settings(false)).unwrap();
        let solution = chain
            .solve(
                &base_pose_for_design(&design),
                &[],
                &[0.0],
                &Vector6::zeros(),
                &Vector3::zeros(),
            )
            .unwrap();
        assert!(solution.converged, "residual {}", solution.residual_norm);
        let centerline = solution.sections[0].centerline_paper();
        for point in &centerline {
            assert!(point[1].abs() < 1e-12);
            assert!(point[2].abs() < 1e-12);
        }
        let tip = solution.tip_pose.translation;
        assert!((tip[0] - chain.sections[0].solver.length_m()).abs() < 1e-9);
    }

    #[test]
    fn displacement_control_reaches_the_target() {
        let design = single_design();
        let mut chain = ChainSolver::new(&design, settings(true)).unwrap();
        let solution = chain
            .solve(
                &base_pose_for_design(&design),
                &[],
                &[3e-3],
                &Vector6::zeros(),
                &Vector3::zeros(),
            )
            .unwrap();
        assert!(solution.converged, "residual {}", solution.residual_norm);
        assert!((solution.sections[0].delta_a_m - 3e-3).abs() < 2e-6);
    }

    #[test]
    fn positive_and_negative_displacements_bend_opposite_ways() {
        let design = single_design();
        let mut chain = ChainSolver::new(&design, settings(true)).unwrap();
        let base = base_pose_for_design(&design);
        let positive = chain
            .solve(&base, &[], &[3e-3], &Vector6::zeros(), &Vector3::zeros())
            .unwrap();
        let negative = chain
            .solve(&base, &[], &[-3e-3], &Vector6::zeros(), &Vector3::zeros())
            .unwrap();
        let positive_tip = positive.sections[0]
            .centerline_paper()
            .last()
            .unwrap()
            .clone();
        let negative_tip = negative.sections[0]
            .centerline_paper()
            .last()
            .unwrap()
            .clone();
        assert!(positive_tip[1] * negative_tip[1] < 0.0);
        assert!(positive_tip[1].abs() > 1e-4);
    }

    #[test]
    fn two_section_chain_converges_with_a_ninety_degree_roll() {
        let design = two_section_design();
        let mut chain = ChainSolver::new(&design, settings(false)).unwrap();
        let solution = chain
            .solve(
                &base_pose_for_design(&design),
                &[0.0, std::f64::consts::FRAC_PI_2],
                &[2e-3, 2e-3],
                &Vector6::zeros(),
                &Vector3::zeros(),
            )
            .unwrap();
        assert!(solution.converged, "residual {}", solution.residual_norm);
        assert_eq!(solution.sections.len(), 2);
        assert_eq!(solution.module_poses.len(), 4);
        let tip = solution.tip_pose.translation;
        assert!(tip.norm().is_finite());
        assert!(solution.residual_norm < 1e-5);
    }
}
