/**
 * Real on-device pose estimation: BlazePose (MediaPipe) via TFLite.
 *
 * Pipeline, per batch of sampled frames:
 *   1. `player.generateThumbnailsAsync(times, { maxWidth, maxHeight })` decodes
 *      many frames in one native call, already scaled down to roughly the
 *      model's input size.
 *   2. `expo-image-manipulator` turns each native image reference into JPEG
 *      bytes, and `jpeg-js` expands those into pixels.
 *   3. The pixels are letterboxed into the model's 256×256 float32 input.
 *   4. `react-native-fast-tflite` runs the landmark model, hardware-accelerated
 *      where a delegate is available.
 *   5. The output is decoded back to normalized frame coordinates.
 *
 * Both halves of step 1 matter for speed. Extracting frames one at a time
 * reopens and re-seeks the asset for every sample; batching lets the native
 * generator walk the timeline once. And asking for a small thumbnail moves the
 * downscale into native code — decoding a full 1080p JPEG in JavaScript costs
 * roughly thirty times as much work per frame as decoding a 256px one, for
 * detail the model immediately throws away.
 *
 * Sampling is bounded by {@link ANALYSIS_BUDGET_MS} rather than run to
 * completion; see `budget.ts`.
 *
 * **This runs the landmark model on the whole frame, without the BlazePose
 * person detector that normally precedes it.** The full two-stage pipeline
 * decodes SSD anchors, then crops and rotates a region of interest before the
 * landmark pass. Skipping it costs accuracy when the athlete is small or far
 * off-centre, and gains a great deal of intricate, easily-wrong code. For
 * technique video — one athlete, framed deliberately, filling much of the shot —
 * the single-stage version is a reasonable trade, and the pose score gates
 * frames where it does not hold. The detector model is downloaded alongside the
 * landmark model so the second stage can be added without changing anything
 * else.
 *
 * The model is fetched once at first use and cached in app storage, rather than
 * committed to the repository: it is ~2.8 MB of binary that would otherwise sit
 * in every checkout and every build.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { decode as decodeJpeg } from 'jpeg-js';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';

import { base64ToBytes } from './base64';
import {
  BLAZEPOSE_INPUT_SIZE,
  decodeBlazePoseFrame,
  readLandmarkTensor,
} from './blazePose';
import { ANALYSIS_BUDGET_MS, planSampling, shouldContinue } from './budget';
import { computeLetterbox, rgbaToModelInput } from './letterbox';
import {
  PoseEstimatorUnavailableError,
  type PoseEstimationRequest,
  type PoseEstimator,
  type PoseFrame,
  type PoseProgress,
  type PoseSequence,
} from './types';

/**
 * Official MediaPipe asset CDN. These are the plain `.tflite` models — the
 * `.task` bundles Google also publishes are just zips of the same two files.
 */
export const POSE_LANDMARK_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-assets/pose_landmark_lite.tflite';

const MODEL_DIRECTORY = 'models';
const MODEL_FILENAME = 'pose_landmark_lite.tflite';

/** Below this pose score the frame is treated as "no athlete found". */
const MIN_POSE_SCORE = 0.2;

/**
 * JPEG quality for the intermediate hand-off out of the native image. The frame
 * is about to be crushed to 256×256 and fed to a landmark model, so anything
 * higher buys detail nobody sees and costs decode time.
 */
const HANDOFF_QUALITY = 0.7;

/**
 * Frames requested per native call. Large enough that the asset is walked once
 * rather than reopened constantly, small enough that progress still moves and
 * the deadline is checked often.
 */
const CHUNK_SIZE = 6;

/** Hard cap on frames per clip, independent of window length. */
const MAX_FRAMES_PER_CLIP = 40;

export class TFLitePoseEstimator implements PoseEstimator {
  readonly id = 'blazepose-tflite';
  readonly displayName = 'BlazePose Lite (on-device)';

  private model: TensorflowModel | null = null;
  private loading: Promise<TensorflowModel> | null = null;

  async isAvailable(): Promise<boolean> {
    // Web has no TFLite runtime and no native thumbnail generator.
    if (Platform.OS === 'web') return false;
    try {
      // Presence of the runtime is what decides availability; the model itself
      // is fetched lazily and may legitimately not be downloaded yet.
      return typeof loadTensorflowModel === 'function';
    } catch {
      return false;
    }
  }

  async prepare(): Promise<void> {
    await this.ensureModel();
  }

  /** Downloads the model once, then reuses the cached copy. */
  private async ensureModel(): Promise<TensorflowModel> {
    if (this.model) return this.model;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const directory = new Directory(Paths.document, MODEL_DIRECTORY);
      if (!directory.exists) directory.create({ intermediates: true });

      const file = new File(directory, MODEL_FILENAME);
      if (!file.exists) {
        try {
          await File.downloadFileAsync(POSE_LANDMARK_MODEL_URL, file);
        } catch {
          throw new PoseEstimatorUnavailableError(
            this.id,
            'Could not download the pose model. Connect to the internet once, and it is cached from then on.'
          );
        }
      }

      const model = await loadTensorflowModel({ url: file.uri }, preferredDelegates());
      this.model = model;
      return model;
    })();

    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async estimate(
    request: PoseEstimationRequest,
    onProgress?: (progress: PoseProgress) => void,
    signal?: AbortSignal
  ): Promise<PoseSequence> {
    const model = await this.ensureModel();
    const { uri, sourceId, startSeconds, endSeconds, sampleFps } = request;

    const plan = planSampling(startSeconds, endSeconds, sampleFps, MAX_FRAMES_PER_CLIP);
    const deadlineAt = request.deadlineAt ?? Date.now() + ANALYSIS_BUDGET_MS / 2;

    // Reuse the caller's player when there is one: the Sync screen already has
    // both clips open, and loading the asset again is pure latency.
    const player = request.player ?? createVideoPlayer(uri);
    const ownsPlayer = request.player == null;

    const frames: PoseFrame[] = [];
    const startedAt = Date.now();

    try {
      for (let offset = 0; offset < plan.times.length; offset += CHUNK_SIZE) {
        if (signal?.aborted) throw abortError();

        const elapsed = Date.now() - startedAt;
        const msPerFrame = frames.length > 0 ? elapsed / (offset || 1) : 0;
        if (!shouldContinue(Date.now(), deadlineAt, offset, msPerFrame, CHUNK_SIZE)) break;

        const times = plan.times.slice(offset, offset + CHUNK_SIZE);
        const decoded = await this.runChunk(model, player, times);
        frames.push(...decoded);

        onProgress?.({
          fraction: Math.min(1, (offset + times.length) / plan.times.length),
          framesDone: offset + times.length,
          framesTotal: plan.times.length,
        });
      }
    } finally {
      // Only release a player this method created; the caller's is still in use.
      if (ownsPlayer) {
        try {
          player.release();
        } catch {
          // Already gone; nothing to do.
        }
      }
    }

    if (frames.length === 0) {
      throw new Error('No athlete was detected anywhere in this part of the clip.');
    }

    // Report the rate actually achieved, not the one requested — every
    // downstream time is derived from it.
    return { sourceId, sampleFps: plan.sampleFps, frames };
  }

  /** One native extraction plus inference for each frame it produced. */
  private async runChunk(
    model: TensorflowModel,
    player: VideoPlayer,
    times: number[]
  ): Promise<PoseFrame[]> {
    let thumbnails;
    try {
      thumbnails = await player.generateThumbnailsAsync(times, {
        // A little over the model input, so the letterbox never upscales.
        maxWidth: BLAZEPOSE_INPUT_SIZE + 64,
        maxHeight: BLAZEPOSE_INPUT_SIZE + 64,
      });
    } catch (error) {
      if (__DEV__) console.warn('[TFLitePoseEstimator] thumbnail batch failed', error);
      return [];
    }

    const frames: PoseFrame[] = [];

    for (let i = 0; i < thumbnails.length; i++) {
      const thumbnail = thumbnails[i];
      if (!thumbnail) continue;
      // `actualTime` is where the decoder really landed, which can differ from
      // the request by up to a keyframe interval. Using the requested time
      // instead would bake that error straight into the alignment.
      const timeSeconds = thumbnail.actualTime ?? times[i] ?? 0;

      try {
        const frame = await this.runFrame(model, thumbnail, timeSeconds);
        if (frame) frames.push(frame);
      } catch (error) {
        // One unreadable frame should not abandon the analysis — the signal
        // extractor interpolates across gaps by design.
        if (__DEV__) console.warn(`[TFLitePoseEstimator] frame at ${timeSeconds}s failed`, error);
      } finally {
        try {
          thumbnail.release();
        } catch {
          // Best-effort.
        }
      }
    }

    return frames;
  }

  private async runFrame(
    model: TensorflowModel,
    thumbnail: { width: number; height: number },
    timeSeconds: number
  ): Promise<PoseFrame | null> {
    // The thumbnail is a native image reference; this is the hand-off to bytes.
    const rendered = await ImageManipulator.manipulate(
      thumbnail as never
    ).renderAsync();
    const saved = await rendered.saveAsync({
      base64: true,
      compress: HANDOFF_QUALITY,
      format: SaveFormat.JPEG,
    });

    try {
      if (!saved.base64) throw new Error('Image encoding returned no data.');

      const jpeg = decodeJpeg(base64ToBytes(saved.base64), { useTArray: true });
      const layout = computeLetterbox(jpeg.width, jpeg.height, BLAZEPOSE_INPUT_SIZE);
      const input = rgbaToModelInput(jpeg.data, layout);

      const outputs = await model.run([input.buffer as ArrayBuffer]);
      const landmarks = readLandmarkTensor(outputs[0]!);
      const poseScore = outputs[1] ? (new Float32Array(outputs[1])[0] ?? 0) : 0;

      // The model always emits 39 landmarks, even for an empty frame; the pose
      // score is what distinguishes a detection from a confident hallucination.
      if (poseScore < MIN_POSE_SCORE) return null;

      return decodeBlazePoseFrame(landmarks, poseScore, layout, timeSeconds);
    } finally {
      try {
        rendered.release();
      } catch {
        // Best-effort.
      }
      // saveAsync writes into the cache; it is never needed again.
      try {
        const file = new File(saved.uri);
        if (file.exists) file.delete();
      } catch {
        // Cache cleanup is best-effort.
      }
    }
  }

  async dispose(): Promise<void> {
    this.model = null;
  }
}

/**
 * Hardware delegates, best first. The runtime falls back to CPU when a delegate
 * cannot be created, so listing an unavailable one is harmless.
 */
function preferredDelegates(): ('core-ml' | 'android-gpu')[] {
  return Platform.OS === 'ios' ? ['core-ml'] : ['android-gpu'];
}

function abortError(): Error {
  const error = new Error('Pose estimation aborted');
  error.name = 'AbortError';
  return error;
}
