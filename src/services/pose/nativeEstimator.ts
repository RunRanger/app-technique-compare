/**
 * Adapter for an on-device pose model exposed as an Expo native module.
 *
 * Nothing native ships in this repo — this class defines the *contract* a real
 * backend must satisfy and degrades cleanly to "unavailable" when no such module
 * is installed, which is what lets {@link PoseEstimatorRegistry} fall back to the
 * simulated estimator without any conditional logic elsewhere.
 *
 * To plug in a real model (MediaPipe Pose Landmarker, TF-Lite MoveNet, Vision
 * `VNDetectHumanBodyPoseRequest`, ML Kit Pose Detection):
 *
 *   1. Create an Expo module named `ExpoPoseLandmarker` (or pass a different
 *      name to the constructor) that implements {@link NativePoseModule}.
 *   2. Decode frames natively — `AVAssetImageGenerator` on iOS,
 *      `MediaMetadataRetriever` / `MediaCodec` on Android — at the requested
 *      sample rate. Decoding in native code is the whole point: shipping raw
 *      frames across the JS bridge would dominate the runtime.
 *   3. Return landmarks normalized to 0..1 with the names in `LANDMARK_NAMES`.
 *
 * Everything downstream — signal extraction, apex/takeoff detection, the offset
 * solver — is model-agnostic and already tested.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

import {
  PoseEstimatorUnavailableError,
  type LandmarkName,
  type PoseEstimationRequest,
  type PoseEstimator,
  type PoseFrame,
  type PoseProgress,
  type PoseSequence,
} from './types';

/** The shape a native pose backend must expose. */
export interface NativePoseModule {
  /** Load model assets. Called once before the first `estimateVideoAsync`. */
  prepareAsync(): Promise<void>;
  /**
   * Decode and run inference over `[startSeconds, endSeconds]` at `sampleFps`.
   * Landmark coordinates must be normalized to the frame (0..1, origin top-left).
   */
  estimateVideoAsync(options: {
    uri: string;
    startSeconds: number;
    endSeconds: number;
    sampleFps: number;
  }): Promise<{
    frames: {
      timeSeconds: number;
      score: number;
      landmarks: { name: string; x: number; y: number; z?: number; visibility?: number }[];
    }[];
  }>;
  /** Optional progress stream; the adapter tolerates its absence. */
  addListener?(
    event: 'poseProgress',
    listener: (payload: { framesDone: number; framesTotal: number }) => void
  ): { remove(): void };
  releaseAsync?(): Promise<void>;
}

const KNOWN_LANDMARKS = new Set<string>([
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
]);

export class NativePoseEstimator implements PoseEstimator {
  readonly id: string;
  readonly displayName: string;

  private module: NativePoseModule | null;
  private prepared = false;

  constructor(
    nativeModuleName = 'ExpoPoseLandmarker',
    displayName = 'On-device pose landmarker'
  ) {
    this.id = `native:${nativeModuleName}`;
    this.displayName = displayName;
    this.module = requireOptionalNativeModule<NativePoseModule>(nativeModuleName);
  }

  async isAvailable(): Promise<boolean> {
    return this.module != null && typeof this.module.estimateVideoAsync === 'function';
  }

  async prepare(): Promise<void> {
    if (!this.module) return;
    if (this.prepared) return;
    await this.module.prepareAsync();
    this.prepared = true;
  }

  async estimate(
    request: PoseEstimationRequest,
    onProgress?: (progress: PoseProgress) => void,
    signal?: AbortSignal
  ): Promise<PoseSequence> {
    const native = this.module;
    if (!native) {
      throw new PoseEstimatorUnavailableError(
        this.id,
        'No native pose module is installed in this build. See src/services/pose/nativeEstimator.ts.'
      );
    }

    await this.prepare();
    if (signal?.aborted) throw abortError();

    const subscription = native.addListener?.('poseProgress', ({ framesDone, framesTotal }) => {
      onProgress?.({
        framesDone,
        framesTotal,
        fraction: framesTotal > 0 ? framesDone / framesTotal : 0,
      });
    });

    try {
      const result = await native.estimateVideoAsync({
        uri: request.uri,
        startSeconds: request.startSeconds,
        endSeconds: request.endSeconds,
        sampleFps: request.sampleFps,
      });
      if (signal?.aborted) throw abortError();

      return {
        sourceId: request.sourceId,
        sampleFps: request.sampleFps,
        frames: result.frames.map(toPoseFrame),
      };
    } finally {
      subscription?.remove();
    }
  }

  async dispose(): Promise<void> {
    await this.module?.releaseAsync?.();
    this.prepared = false;
  }
}

function toPoseFrame(raw: {
  timeSeconds: number;
  score: number;
  landmarks: { name: string; x: number; y: number; z?: number; visibility?: number }[];
}): PoseFrame {
  const landmarks: PoseFrame['landmarks'] = {};
  for (const point of raw.landmarks) {
    // Ignore landmarks outside our topology rather than trusting a native
    // module to match it exactly — models differ in how many points they emit.
    if (!KNOWN_LANDMARKS.has(point.name)) continue;
    landmarks[point.name as LandmarkName] = {
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility,
    };
  }
  return { timeSeconds: raw.timeSeconds, landmarks, score: raw.score };
}

function abortError(): Error {
  const error = new Error('Pose estimation aborted');
  error.name = 'AbortError';
  return error;
}
