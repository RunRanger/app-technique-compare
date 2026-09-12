/**
 * Pose estimation contract.
 *
 * The app ships without a bundled pose model. What it *does* ship is the full
 * pipeline around one: sampling, signal extraction, event detection and offset
 * solving are all real and tested. Dropping in MediaPipe Pose Landmarker or a
 * TF-Lite MoveNet model is then a matter of implementing {@link PoseEstimator}
 * and registering it — no other code changes.
 *
 * All coordinates are **normalized to the frame** (0..1, origin top-left) so an
 * implementation can swap resolutions or crop without invalidating downstream
 * analysis. Note that `y` grows *downward*, which is why "higher in the air"
 * means a *smaller* y — the signal extractors flip this where it matters.
 */

import type { VideoPlayer } from 'expo-video';

/** The landmarks the analysis layer relies on. A subset of the 33-point BlazePose topology. */
export const LANDMARK_NAMES = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];

export interface Landmark {
  /** 0..1, left to right. */
  x: number;
  /** 0..1, top to bottom. */
  y: number;
  /** Optional depth, model-dependent scale. */
  z?: number;
  /** 0..1 detector confidence for this point. */
  visibility?: number;
}

export interface PoseFrame {
  /** Time within the clip, in seconds. */
  timeSeconds: number;
  landmarks: Partial<Record<LandmarkName, Landmark>>;
  /** 0..1 overall confidence that a person was found in this frame. */
  score: number;
}

export interface PoseSequence {
  /** Identifies the clip this came from — used for caching. */
  sourceId: string;
  /** The rate frames were sampled at (not the clip's own frame rate). */
  sampleFps: number;
  /** Ordered by `timeSeconds`, ascending. */
  frames: PoseFrame[];
}

export interface PoseEstimationRequest {
  /** Playable URI of the clip. */
  uri: string;
  /**
   * An already-loaded player for this clip, if the caller has one.
   *
   * Purely an optimization: an estimator that needs to decode frames can reuse
   * it instead of opening the asset a second time, which is dead latency when a
   * screen is displaying the clip anyway. Estimators must work without it.
   */
  player?: VideoPlayer;
  /**
   * Wall-clock time after which sampling should stop and the estimator should
   * return what it has. Absent means "no deadline".
   */
  deadlineAt?: number;
  /** Stable id for cache keying. */
  sourceId: string;
  startSeconds: number;
  endSeconds: number;
  /**
   * How densely to sample. 15 fps is plenty for locating a takeoff or apex and
   * keeps a several-second window well under a thousand inferences.
   */
  sampleFps: number;
}

export interface PoseProgress {
  /** 0..1 */
  fraction: number;
  framesDone: number;
  framesTotal: number;
}

/**
 * A source of pose data. Implementations must be safe to call concurrently for
 * two different clips, and must honour `signal` for cancellation.
 */
export interface PoseEstimator {
  /** Stable identifier, e.g. `'mediapipe-pose'`. */
  readonly id: string;
  readonly displayName: string;
  /**
   * Whether this estimator can actually run here. A native-backed estimator
   * should return `false` rather than throwing when its module is absent, so
   * the registry can fall back cleanly.
   */
  isAvailable(): Promise<boolean>;
  /** Warm up models. Safe to call repeatedly. */
  prepare?(): Promise<void>;
  estimate(
    request: PoseEstimationRequest,
    onProgress?: (progress: PoseProgress) => void,
    signal?: AbortSignal
  ): Promise<PoseSequence>;
  /** Release native resources. */
  dispose?(): Promise<void>;
}

/** Thrown when an estimator is asked to run but its backend is missing. */
export class PoseEstimatorUnavailableError extends Error {
  constructor(
    public readonly estimatorId: string,
    message: string
  ) {
    super(message);
    this.name = 'PoseEstimatorUnavailableError';
  }
}
