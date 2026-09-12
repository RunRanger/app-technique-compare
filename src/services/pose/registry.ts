/**
 * Estimator registry.
 *
 * Estimators are tried in registration order and the first *available* one wins,
 * so a real native backend automatically takes precedence over the simulated
 * fallback simply by being registered first. Results are cached per
 * (estimator, clip, window, rate) because pose extraction is the expensive part
 * of auto-sync and users retry it often while nudging the window.
 */

import { MockPoseEstimator } from './mockEstimator';
import { NativePoseEstimator } from './nativeEstimator';
import { TFLitePoseEstimator } from './tfliteEstimator';
import type {
  PoseEstimationRequest,
  PoseEstimator,
  PoseProgress,
  PoseSequence,
} from './types';

const cacheKey = (estimatorId: string, request: PoseEstimationRequest): string =>
  [
    estimatorId,
    request.sourceId,
    request.startSeconds.toFixed(3),
    request.endSeconds.toFixed(3),
    request.sampleFps,
  ].join('|');

export class PoseEstimatorRegistry {
  private readonly estimators: PoseEstimator[] = [];
  private readonly cache = new Map<string, PoseSequence>();
  private resolved: PoseEstimator | null = null;

  register(estimator: PoseEstimator): void {
    this.estimators.push(estimator);
    // A new registration may outrank the cached choice.
    this.resolved = null;
  }

  /** All registered estimators, in priority order. */
  list(): readonly PoseEstimator[] {
    return this.estimators;
  }

  /** The highest-priority estimator that reports itself usable. */
  async getActive(): Promise<PoseEstimator | null> {
    if (this.resolved) return this.resolved;
    for (const estimator of this.estimators) {
      if (await estimator.isAvailable()) {
        this.resolved = estimator;
        return estimator;
      }
    }
    return null;
  }

  /**
   * Whether the active estimator is a real model rather than the simulation.
   * The UI uses this to label auto-sync results honestly.
   */
  async isSimulated(): Promise<boolean> {
    const active = await this.getActive();
    return active == null || active.id === 'mock-pose';
  }

  async estimate(
    request: PoseEstimationRequest,
    onProgress?: (progress: PoseProgress) => void,
    signal?: AbortSignal
  ): Promise<PoseSequence> {
    const estimator = await this.getActive();
    if (!estimator) {
      throw new Error('No pose estimator is available.');
    }

    const key = cacheKey(estimator.id, request);
    const cached = this.cache.get(key);
    if (cached) {
      onProgress?.({ fraction: 1, framesDone: cached.frames.length, framesTotal: cached.frames.length });
      return cached;
    }

    const sequence = await estimator.estimate(request, onProgress, signal);
    this.cache.set(key, sequence);
    return sequence;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * App-wide registry, in priority order:
 *
 *  1. a custom native module, if a build provides one (see `nativeEstimator`);
 *  2. BlazePose via TFLite — the model that actually ships;
 *  3. the simulation, so the app still works on web or when the model cannot be
 *     downloaded.
 */
export const poseRegistry = new PoseEstimatorRegistry();
poseRegistry.register(new NativePoseEstimator());
poseRegistry.register(new TFLitePoseEstimator());
poseRegistry.register(new MockPoseEstimator({ msPerFrame: 1 }));
