/**
 * A deterministic synthetic pose source.
 *
 * Its purpose is not to fake analysis results but to exercise the *pipeline*:
 * with it registered, auto-sync runs end to end — sampling, signal extraction,
 * apex detection, cross-correlation — on plausible data, on a simulator, with
 * no native model present. Because the generated motion is derived from a hash
 * of the clip's id, two different clips produce genuinely different takeoff
 * times, so the solved offset is a real (non-zero, non-trivial) result.
 */

import {
  LANDMARK_NAMES,
  type Landmark,
  type LandmarkName,
  type PoseEstimationRequest,
  type PoseEstimator,
  type PoseFrame,
  type PoseProgress,
  type PoseSequence,
} from './types';

/** FNV-1a — small, stable, and dependency-free. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic 0..1 value from a seed and a channel index. */
const seeded = (seed: number, channel: number): number =>
  ((Math.imul(seed ^ (channel * 0x9e3779b9), 0x85ebca6b) >>> 0) % 100000) / 100000;

export interface MockPoseOptions {
  /** Simulated per-frame cost, so progress reporting is observable in the UI. */
  msPerFrame?: number;
}

export class MockPoseEstimator implements PoseEstimator {
  readonly id = 'mock-pose';
  readonly displayName = 'Simulated pose (no model installed)';

  constructor(private readonly options: MockPoseOptions = {}) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async estimate(
    request: PoseEstimationRequest,
    onProgress?: (progress: PoseProgress) => void,
    signal?: AbortSignal
  ): Promise<PoseSequence> {
    const { startSeconds, endSeconds, sampleFps, sourceId } = request;
    const step = 1 / sampleFps;
    const span = Math.max(0, endSeconds - startSeconds);
    const framesTotal = Math.max(1, Math.floor(span * sampleFps) + 1);

    const seed = hashString(sourceId);
    // Takeoff sits somewhere in the middle 60% of the window; flight time varies
    // a little between clips, as it would between two real athletes.
    const takeoff = startSeconds + span * (0.2 + 0.6 * seeded(seed, 1));
    const flightTime = 0.45 + 0.35 * seeded(seed, 2);
    const runUpSpeed = 0.05 + 0.1 * seeded(seed, 3);

    const frames: PoseFrame[] = [];
    const msPerFrame = this.options.msPerFrame ?? 0;

    for (let i = 0; i < framesTotal; i++) {
      if (signal?.aborted) throw new DOMExceptionLike('Pose estimation aborted');
      const t = startSeconds + i * step;
      frames.push(this.frameAt(t, takeoff, flightTime, runUpSpeed, seed));

      if (msPerFrame > 0 && i % 5 === 0) {
        await sleep(msPerFrame * 5);
      }
      onProgress?.({ fraction: (i + 1) / framesTotal, framesDone: i + 1, framesTotal });
    }

    return { sourceId, sampleFps, frames };
  }

  /**
   * Models a jump: the hips travel forward at a steady run-up speed and follow a
   * ballistic arc between takeoff and landing. Ankles trail the hips and tuck
   * during flight, which is what makes the ankle channel a distinct signal.
   */
  private frameAt(
    t: number,
    takeoff: number,
    flightTime: number,
    runUpSpeed: number,
    seed: number
  ): PoseFrame {
    const landing = takeoff + flightTime;
    const groundY = 0.72;
    const peakRise = 0.3;

    let rise = 0;
    if (t >= takeoff && t <= landing) {
      // Normalized parabola, 0 at both ends and 1 at the apex.
      const phase = (t - takeoff) / flightTime;
      rise = 4 * phase * (1 - phase) * peakRise;
    }

    const hipY = groundY - rise;
    const hipX = 0.5 + (t - takeoff) * runUpSpeed;
    // Tuck: ankles rise toward the hips at the apex.
    const tuck = rise / peakRise;
    const ankleY = groundY + 0.22 - rise - tuck * 0.1;
    const noise = (channel: number) => (seeded(seed, channel + Math.floor(t * 1000)) - 0.5) * 0.002;

    const landmarks: Partial<Record<LandmarkName, Landmark>> = {};
    const put = (name: LandmarkName, x: number, y: number, channel: number) => {
      landmarks[name] = {
        x: clamp01(x + noise(channel)),
        y: clamp01(y + noise(channel + 1)),
        visibility: 0.9,
      };
    };

    put('nose', hipX, hipY - 0.36, 10);
    put('leftShoulder', hipX - 0.07, hipY - 0.24, 12);
    put('rightShoulder', hipX + 0.07, hipY - 0.24, 14);
    put('leftElbow', hipX - 0.11, hipY - 0.12, 16);
    put('rightElbow', hipX + 0.11, hipY - 0.12, 18);
    put('leftWrist', hipX - 0.13, hipY - 0.02, 20);
    put('rightWrist', hipX + 0.13, hipY - 0.02, 22);
    put('leftHip', hipX - 0.05, hipY, 24);
    put('rightHip', hipX + 0.05, hipY, 26);
    put('leftKnee', hipX - 0.05, hipY + 0.12 - tuck * 0.05, 28);
    put('rightKnee', hipX + 0.05, hipY + 0.12 - tuck * 0.05, 30);
    put('leftAnkle', hipX - 0.05, ankleY, 32);
    put('rightAnkle', hipX + 0.05, ankleY, 34);

    // Sanity: the generator must cover every landmark the analysis layer may ask for.
    if (__DEV__ && Object.keys(landmarks).length !== LANDMARK_NAMES.length) {
      console.warn('[MockPoseEstimator] landmark coverage mismatch');
    }

    return { timeSeconds: t, landmarks, score: 0.9 };
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `DOMException` is not guaranteed on every RN runtime; this keeps aborts typed. */
class DOMExceptionLike extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}
