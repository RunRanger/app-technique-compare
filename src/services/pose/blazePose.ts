/**
 * Decoding BlazePose's landmark output.
 *
 * Split from the estimator so it can be tested without a model or a device. The
 * constants here were read off the real `pose_landmark_lite.tflite` rather than
 * assumed:
 *
 *   input   `[1, 256, 256, 3]` float32
 *   output0 `[1, 195]`  39 landmarks × 5 — x, y, z, visibility, presence
 *   output1 `[1, 1]`    pose presence, already a probability in 0..1
 *
 * Two details are easy to get wrong and were checked by running the model:
 *
 *  - x and y come back in **pixels of the 256×256 input**, not normalized, so
 *    they need dividing by the input size before the letterbox mapping.
 *  - visibility and presence are **logits** spanning roughly ±18, so they need a
 *    sigmoid. Output1 does not — it is already a probability, and reads ~0 for a
 *    frame with no person in it, which makes it a reliable "found nobody" gate.
 */

import type { LandmarkName, PoseFrame } from './types';
import { modelPointToFrame, type LetterboxLayout } from './letterbox';

export const BLAZEPOSE_INPUT_SIZE = 256;
/** 33 body points plus 6 auxiliary ones the model emits. */
export const BLAZEPOSE_LANDMARK_COUNT = 39;
export const BLAZEPOSE_VALUES_PER_LANDMARK = 5;

/**
 * The subset of BlazePose's topology this app analyses, by output index.
 * Indices follow the standard 33-point BlazePose ordering.
 */
export const BLAZEPOSE_INDICES: Record<LandmarkName, number> = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

export const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

/**
 * Turns one inference result into a {@link PoseFrame} in normalized
 * source-frame coordinates.
 *
 * @param landmarks  output0, 195 floats
 * @param poseScore  output1, already a probability
 */
export function decodeBlazePoseFrame(
  landmarks: Float32Array,
  poseScore: number,
  layout: LetterboxLayout,
  timeSeconds: number
): PoseFrame {
  const result: PoseFrame['landmarks'] = {};

  for (const [name, index] of Object.entries(BLAZEPOSE_INDICES) as [LandmarkName, number][]) {
    const base = index * BLAZEPOSE_VALUES_PER_LANDMARK;
    const rawX = landmarks[base];
    const rawY = landmarks[base + 1];
    const rawZ = landmarks[base + 2];
    const rawVisibility = landmarks[base + 3];
    const rawPresence = landmarks[base + 4];
    if (rawX == null || rawY == null) continue;

    const point = modelPointToFrame(rawX, rawY, layout);

    // Both gates have to pass: "visible" and "present" fail in different ways —
    // an occluded joint scores low on one, a joint the model invented off-frame
    // on the other.
    const visibility = Math.min(
      sigmoid(rawVisibility ?? 0),
      sigmoid(rawPresence ?? 0)
    );

    result[name] = {
      x: point.x,
      y: point.y,
      z: rawZ != null ? rawZ / BLAZEPOSE_INPUT_SIZE : undefined,
      visibility,
    };
  }

  return { timeSeconds, landmarks: result, score: poseScore };
}

/** Reads output0 out of the raw buffer the runtime returns. */
export function readLandmarkTensor(buffer: ArrayBuffer): Float32Array {
  const expected = BLAZEPOSE_LANDMARK_COUNT * BLAZEPOSE_VALUES_PER_LANDMARK;
  const view = new Float32Array(buffer);
  if (view.length < expected) {
    throw new Error(
      `Pose model returned ${view.length} values, expected at least ${expected}. ` +
        'The bundled model may not be BlazePose.'
    );
  }
  return view;
}
