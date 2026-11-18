import type { Project, RobotResult } from '../types';
import { quatFromMat, type RobotAssembly } from '../design/robot';
import type { CosseratFrame, CosseratResult } from './solver';

function frameMatrix(frame: CosseratFrame): [number, number, number, number, number, number, number, number, number] {
  const p = frame.pose;
  return [p[0][0], p[0][1], p[0][2], p[1][0], p[1][1], p[1][2], p[2][0], p[2][1], p[2][2]];
}

/** Frame position on the shared CPPR centreline (removes the centroid offset). */
function centerlinePosition(frame: CosseratFrame): [number, number, number] {
  const p = frame.pose;
  const d = frame.centroidOffsetMm;
  return [p[0][3] - p[0][0] * d, p[1][3] - p[1][0] * d, p[2][3] - p[2][0] * d];
}

function frameAt(frames: CosseratFrame[], sMm: number): CosseratFrame | null {
  if (frames.length === 0) return null;
  let best = frames[0];
  let bestDistance = Math.abs(best.sMm - sMm);
  for (const frame of frames) {
    const distance = Math.abs(frame.sMm - sMm);
    if (distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Adapts the rod solver output to the renderer's assembly structure. Notch
 * rings are placed at each designed notch arc length using the solved leader
 * frame, so they follow the actual 3D bend rather than the planar prediction.
 */
export function buildCosseratAssembly(
  project: Project,
  result: RobotResult,
  cosserat: CosseratResult,
): RobotAssembly {
  const enabled = project.segments.filter((s) => s.enabled);
  const worldSegments: RobotResult['worldSegments'] = [];
  const worldShape: [number, number, number][] = [];
  let totalLength = 0;

  cosserat.sections.forEach((section, index) => {
    const segmentId = cosserat.segmentIds[index];
    const cfg = enabled.find((s) => s.id === segmentId);
    const res = result.segments.find((r) => r.segmentId === segmentId);
    if (!cfg || !res || section.centerline.length < 2) return;
    const points = section.centerline;
    const notches = res.notches.map((notch) => {
      const frame = frameAt(section.leader, notch.zCenter);
      if (!frame) {
        const p = points[Math.min(points.length - 1, Math.max(0, Math.round((notch.zCenter / Math.max(1e-6, res.activeTubeLength)) * (points.length - 1))))];
        return { position: p, quaternion: [0, 0, 0, 1] as [number, number, number, number], h: notch.h };
      }
      return {
        position: centerlinePosition(frame),
        quaternion: quatFromMat(frameMatrix(frame)),
        h: notch.h,
      };
    });
    const frames = notches.map((notch) => ({ position: notch.position, quaternion: notch.quaternion }));
    worldSegments.push({
      segmentId,
      points,
      tip: points[points.length - 1],
      frames,
      notches,
    });
    if (worldShape.length === 0) worldShape.push(...points);
    else worldShape.push(...points.slice(1));
    totalLength += points[points.length - 1][2] - points[0][2];
  });

  if (cosserat.centerline.length > 0) {
    // The chain centreline includes the inter-section connectors and is the
    // authoritative full-robot curve for fitting and overlays.
    worldShape.length = 0;
    worldShape.push(...cosserat.centerline);
  }
  return { worldShape, worldSegments, totalLength };
}
