import {
  BLAZEPOSE_INDICES,
  BLAZEPOSE_INPUT_SIZE,
  BLAZEPOSE_LANDMARK_COUNT,
  BLAZEPOSE_VALUES_PER_LANDMARK,
  decodeBlazePoseFrame,
  readLandmarkTensor,
  sigmoid,
} from '@/services/pose/blazePose';
import { computeLetterbox, framePointToModel } from '@/services/pose/letterbox';
import { LANDMARK_NAMES } from '@/services/pose/types';

/** Builds an output0 tensor placing every mapped landmark at a known frame point. */
function tensorWith(
  layout: ReturnType<typeof computeLetterbox>,
  frameX: number,
  frameY: number,
  visibilityLogit = 5,
  presenceLogit = 5
): Float32Array {
  const data = new Float32Array(BLAZEPOSE_LANDMARK_COUNT * BLAZEPOSE_VALUES_PER_LANDMARK);
  const model = framePointToModel(frameX, frameY, layout);
  for (const index of Object.values(BLAZEPOSE_INDICES)) {
    const base = index * BLAZEPOSE_VALUES_PER_LANDMARK;
    data[base] = model.x;
    data[base + 1] = model.y;
    data[base + 2] = 0;
    data[base + 3] = visibilityLogit;
    data[base + 4] = presenceLogit;
  }
  return data;
}

describe('sigmoid', () => {
  it('maps logits to probabilities', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 10);
    expect(sigmoid(18)).toBeGreaterThan(0.99);
    expect(sigmoid(-18)).toBeLessThan(0.01);
  });
});

describe('BLAZEPOSE_INDICES', () => {
  it('covers every landmark the analysis layer asks for', () => {
    for (const name of LANDMARK_NAMES) {
      expect(BLAZEPOSE_INDICES[name]).toBeDefined();
    }
  });

  it('uses distinct indices inside the model output', () => {
    const indices = Object.values(BLAZEPOSE_INDICES);
    expect(new Set(indices).size).toBe(indices.length);
    for (const index of indices) {
      expect(index).toBeLessThan(BLAZEPOSE_LANDMARK_COUNT);
    }
  });
});

describe('decodeBlazePoseFrame', () => {
  const layout = computeLetterbox(1920, 1080, BLAZEPOSE_INPUT_SIZE);

  it('converts input pixels back to normalized frame coordinates', () => {
    const frame = decodeBlazePoseFrame(tensorWith(layout, 0.25, 0.75), 0.9, layout, 1.5);
    const hip = frame.landmarks.leftHip!;
    expect(hip.x).toBeCloseTo(0.25, 5);
    expect(hip.y).toBeCloseTo(0.75, 5);
    expect(frame.timeSeconds).toBe(1.5);
    expect(frame.score).toBe(0.9);
  });

  it('accounts for the letterbox rather than dividing by the input size', () => {
    // A landmark at the vertical centre of a 16:9 frame is at input y=128. If
    // padding were ignored it would decode to 0.5 either way, so use a point
    // where the two differ: the frame's top edge.
    const frame = decodeBlazePoseFrame(tensorWith(layout, 0.5, 0), 0.9, layout, 0);
    expect(frame.landmarks.nose!.y).toBeCloseTo(0, 5);
    // Naively dividing input y (56) by 256 would have given ~0.22.
  });

  it('applies a sigmoid to the visibility logits', () => {
    const confident = decodeBlazePoseFrame(tensorWith(layout, 0.5, 0.5, 8, 8), 0.9, layout, 0);
    expect(confident.landmarks.nose!.visibility!).toBeGreaterThan(0.99);

    const doubtful = decodeBlazePoseFrame(tensorWith(layout, 0.5, 0.5, -8, -8), 0.9, layout, 0);
    expect(doubtful.landmarks.nose!.visibility!).toBeLessThan(0.01);
  });

  it('takes the stricter of visibility and presence', () => {
    // Visible but not present must not read as a confident detection.
    const frame = decodeBlazePoseFrame(tensorWith(layout, 0.5, 0.5, 8, -8), 0.9, layout, 0);
    expect(frame.landmarks.nose!.visibility!).toBeLessThan(0.01);
  });

  it('passes the pose score through untouched, since it is already a probability', () => {
    expect(decodeBlazePoseFrame(tensorWith(layout, 0.5, 0.5), 0.02, layout, 0).score).toBe(0.02);
  });

  it('works for portrait frames too', () => {
    const portrait = computeLetterbox(1080, 1920, BLAZEPOSE_INPUT_SIZE);
    const frame = decodeBlazePoseFrame(tensorWith(portrait, 0, 0.5), 0.9, portrait, 0);
    expect(frame.landmarks.nose!.x).toBeCloseTo(0, 5);
  });
});

describe('readLandmarkTensor', () => {
  it('accepts a correctly sized buffer', () => {
    const data = new Float32Array(BLAZEPOSE_LANDMARK_COUNT * BLAZEPOSE_VALUES_PER_LANDMARK);
    expect(readLandmarkTensor(data.buffer).length).toBe(195);
  });

  it('rejects a buffer from a different model rather than reading garbage', () => {
    expect(() => readLandmarkTensor(new Float32Array(10).buffer)).toThrow(/expected at least/i);
  });
});
