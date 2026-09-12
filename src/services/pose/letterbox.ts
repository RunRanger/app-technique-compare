/**
 * Fitting a video frame into the model's square input, and mapping landmarks
 * back out again.
 *
 * BlazePose takes a 256×256 image. Video frames are not square, so the frame is
 * scaled to fit and centred with padding — "letterboxed". The model then reports
 * landmarks in *its* 256×256 space, and those coordinates mean nothing until the
 * padding is subtracted and the scale undone.
 *
 * Getting this wrong is quiet rather than loud: landmarks still look plausible,
 * but every one of them is offset, and the size and alignment measurements built
 * on top drift with the frame's aspect ratio. So the mapping lives here, as pure
 * arithmetic with tests, instead of inline in the inference loop.
 */

export interface LetterboxLayout {
  /** Model input edge length, in pixels. */
  inputSize: number;
  /** Scale applied to the source frame. */
  scale: number;
  /** Size of the scaled frame inside the square input. */
  drawWidth: number;
  drawHeight: number;
  /** Padding on the left and top, in input pixels. */
  padX: number;
  padY: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** Computes the fit of a `sourceWidth × sourceHeight` frame into a square input. */
export function computeLetterbox(
  sourceWidth: number,
  sourceHeight: number,
  inputSize: number
): LetterboxLayout {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.min(inputSize / safeWidth, inputSize / safeHeight);
  const drawWidth = safeWidth * scale;
  const drawHeight = safeHeight * scale;
  return {
    inputSize,
    scale,
    drawWidth,
    drawHeight,
    padX: (inputSize - drawWidth) / 2,
    padY: (inputSize - drawHeight) / 2,
    sourceWidth: safeWidth,
    sourceHeight: safeHeight,
  };
}

/**
 * Maps a landmark from model-input pixels back to normalized source-frame
 * coordinates (0..1, origin top-left).
 *
 * Values outside 0..1 are returned as they are rather than clamped: a landmark
 * that lands in the padding really is outside the frame, and the visibility
 * filter downstream should be what discards it, not a silent clamp that would
 * pin it to an edge and look like a real detection.
 */
export function modelPointToFrame(
  x: number,
  y: number,
  layout: LetterboxLayout
): { x: number; y: number } {
  return {
    x: (x - layout.padX) / layout.drawWidth,
    y: (y - layout.padY) / layout.drawHeight,
  };
}

/** The inverse, useful for tests and for drawing an overlay. */
export function framePointToModel(
  x: number,
  y: number,
  layout: LetterboxLayout
): { x: number; y: number } {
  return {
    x: x * layout.drawWidth + layout.padX,
    y: y * layout.drawHeight + layout.padY,
  };
}

/**
 * Resamples RGBA pixel data into the model's square float32 RGB input.
 *
 * Nearest-neighbour is deliberate. The alternative, bilinear, costs noticeably
 * more per frame for a landmark model that is already robust to that level of
 * detail — and this runs once per sampled frame across two clips, so the
 * constant factor is what decides whether analysis takes seconds or minutes.
 *
 * Padding is filled with mid-grey rather than black: a black border reads as a
 * high-contrast edge to the network, which is exactly the sort of feature it
 * hunts for.
 */
export function rgbaToModelInput(
  rgba: Uint8Array | Uint8ClampedArray,
  layout: LetterboxLayout
): Float32Array {
  const { inputSize, drawWidth, drawHeight, padX, padY, sourceWidth, sourceHeight } = layout;
  const out = new Float32Array(inputSize * inputSize * 3);
  out.fill(0.5);

  const startX = Math.round(padX);
  const startY = Math.round(padY);
  const endX = Math.min(inputSize, Math.round(padX + drawWidth));
  const endY = Math.min(inputSize, Math.round(padY + drawHeight));

  for (let y = startY; y < endY; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(((y - padY) / drawHeight) * sourceHeight));
    for (let x = startX; x < endX; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(((x - padX) / drawWidth) * sourceWidth));
      const source = (sourceY * sourceWidth + sourceX) * 4;
      const target = (y * inputSize + x) * 3;
      out[target] = (rgba[source] ?? 0) / 255;
      out[target + 1] = (rgba[source + 1] ?? 0) / 255;
      out[target + 2] = (rgba[source + 2] ?? 0) / 255;
    }
  }

  return out;
}
