import {
  computeLetterbox,
  framePointToModel,
  modelPointToFrame,
  rgbaToModelInput,
} from '@/services/pose/letterbox';

describe('computeLetterbox', () => {
  it('pads top and bottom for a landscape frame', () => {
    const layout = computeLetterbox(1920, 1080, 256);
    expect(layout.drawWidth).toBeCloseTo(256);
    expect(layout.drawHeight).toBeCloseTo(144);
    expect(layout.padX).toBeCloseTo(0);
    expect(layout.padY).toBeCloseTo(56);
  });

  it('pads left and right for a portrait frame', () => {
    const layout = computeLetterbox(1080, 1920, 256);
    expect(layout.drawHeight).toBeCloseTo(256);
    expect(layout.padY).toBeCloseTo(0);
    expect(layout.padX).toBeCloseTo(56);
  });

  it('needs no padding for a square frame', () => {
    const layout = computeLetterbox(512, 512, 256);
    expect(layout.padX).toBe(0);
    expect(layout.padY).toBe(0);
    expect(layout.scale).toBeCloseTo(0.5);
  });

  it('survives a degenerate frame size without dividing by zero', () => {
    const layout = computeLetterbox(0, 0, 256);
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(layout.drawWidth).toBeGreaterThan(0);
  });
});

describe('coordinate mapping', () => {
  const landscape = computeLetterbox(1920, 1080, 256);
  const portrait = computeLetterbox(1080, 1920, 256);

  it('maps the frame centre to the input centre and back', () => {
    for (const layout of [landscape, portrait]) {
      const model = framePointToModel(0.5, 0.5, layout);
      expect(model.x).toBeCloseTo(128, 6);
      expect(model.y).toBeCloseTo(128, 6);

      const frame = modelPointToFrame(model.x, model.y, layout);
      expect(frame.x).toBeCloseTo(0.5, 6);
      expect(frame.y).toBeCloseTo(0.5, 6);
    }
  });

  it('round-trips arbitrary points', () => {
    for (const layout of [landscape, portrait]) {
      for (const [x, y] of [
        [0, 0],
        [1, 1],
        [0.25, 0.75],
        [0.9, 0.1],
      ]) {
        const model = framePointToModel(x!, y!, layout);
        const back = modelPointToFrame(model.x, model.y, layout);
        expect(back.x).toBeCloseTo(x!, 6);
        expect(back.y).toBeCloseTo(y!, 6);
      }
    }
  });

  it('accounts for the padding rather than treating the input as the frame', () => {
    // Frame top edge sits 56px down in a landscape letterbox, not at 0 — the
    // bug this mapping exists to prevent.
    expect(framePointToModel(0.5, 0, landscape).y).toBeCloseTo(56, 6);
    expect(modelPointToFrame(128, 56, landscape).y).toBeCloseTo(0, 6);
  });

  it('reports landmarks that fall in the padding as outside the frame', () => {
    // A point above the letterboxed image maps to a negative y, and is not
    // silently clamped to the edge.
    expect(modelPointToFrame(128, 10, landscape).y).toBeLessThan(0);
  });
});

describe('rgbaToModelInput', () => {
  /** A solid-colour RGBA buffer. */
  function solid(width: number, height: number, r: number, g: number, b: number): Uint8Array {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return data;
  }

  it('produces the model input shape', () => {
    const layout = computeLetterbox(64, 64, 256);
    const input = rgbaToModelInput(solid(64, 64, 255, 0, 0), layout);
    expect(input.length).toBe(256 * 256 * 3);
  });

  it('normalizes channel values to 0..1', () => {
    const layout = computeLetterbox(64, 64, 256);
    const input = rgbaToModelInput(solid(64, 64, 255, 0, 0), layout);
    // Centre pixel is inside the image: pure red.
    const centre = (128 * 256 + 128) * 3;
    expect(input[centre]).toBeCloseTo(1, 6);
    expect(input[centre + 1]).toBeCloseTo(0, 6);
    expect(input[centre + 2]).toBeCloseTo(0, 6);
  });

  it('fills padding with mid-grey, not black', () => {
    // A wide frame leaves padding at the top; a black border would read as a
    // strong edge to the network.
    const layout = computeLetterbox(256, 64, 256);
    const input = rgbaToModelInput(solid(256, 64, 255, 255, 255), layout);
    const topPixel = (2 * 256 + 128) * 3;
    expect(input[topPixel]).toBeCloseTo(0.5, 6);
  });

  it('keeps every value inside 0..1', () => {
    const layout = computeLetterbox(32, 48, 256);
    const input = rgbaToModelInput(solid(32, 48, 12, 200, 77), layout);
    for (let i = 0; i < input.length; i += 997) {
      expect(input[i]!).toBeGreaterThanOrEqual(0);
      expect(input[i]!).toBeLessThanOrEqual(1);
    }
  });
});
