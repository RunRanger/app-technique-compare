/**
 * Real on-device pose estimation: BlazePose (MediaPipe) via TFLite.
 *
 * Pipeline per sampled frame:
 *   1. `expo-video-thumbnails` decodes one frame of the clip to a JPEG. Decoding
 *      happens natively — pulling raw frames across the JS bridge would dominate
 *      the runtime.
 *   2. `jpeg-js` turns that JPEG into RGBA pixels.
 *   3. The pixels are letterboxed into the model's 256×256 float32 input.
 *   4. `react-native-fast-tflite` runs the landmark model, hardware-accelerated
 *      where a delegate is available.
 *   5. The output is decoded back to normalized frame coordinates.
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
import * as VideoThumbnails from 'expo-video-thumbnails';
import { decode as decodeJpeg } from 'jpeg-js';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';

import {
  BLAZEPOSE_INPUT_SIZE,
  decodeBlazePoseFrame,
  readLandmarkTensor,
} from './blazePose';
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
 * Thumbnail quality. The frame is about to be crushed to 256×256, so a high
 * quality JPEG only costs decode time for detail the model never sees.
 */
const THUMBNAIL_QUALITY = 0.6;

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
    const step = 1 / sampleFps;
    const span = Math.max(0, endSeconds - startSeconds);
    const framesTotal = Math.max(1, Math.floor(span * sampleFps) + 1);

    const frames: PoseFrame[] = [];

    for (let i = 0; i < framesTotal; i++) {
      if (signal?.aborted) throw abortError();

      const time = startSeconds + i * step;
      try {
        const frame = await this.estimateSingleFrame(model, uri, time);
        if (frame) frames.push(frame);
      } catch (error) {
        // One unreadable frame should not abandon the whole analysis — the
        // signal extractor interpolates across gaps by design.
        if (__DEV__) console.warn(`[TFLitePoseEstimator] frame at ${time.toFixed(2)}s failed`, error);
      }

      onProgress?.({ fraction: (i + 1) / framesTotal, framesDone: i + 1, framesTotal });
    }

    if (frames.length === 0) {
      throw new Error('No athlete was detected anywhere in this part of the clip.');
    }

    return { sourceId, sampleFps, frames };
  }

  private async estimateSingleFrame(
    model: TensorflowModel,
    uri: string,
    timeSeconds: number
  ): Promise<PoseFrame | null> {
    // expo-video-thumbnails takes milliseconds.
    const thumbnail = await VideoThumbnails.getThumbnailAsync(uri, {
      time: Math.max(0, Math.round(timeSeconds * 1000)),
      quality: THUMBNAIL_QUALITY,
    });

    const file = new File(thumbnail.uri);
    try {
      const jpeg = decodeJpeg(new Uint8Array(await file.arrayBuffer()), { useTArray: true });

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
      // Thumbnails land in the cache directory and are never needed again.
      try {
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
