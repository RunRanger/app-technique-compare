/**
 * Base64 → bytes.
 *
 * The frame pipeline gets JPEG data out of a native image as a base64 string,
 * which has to become a byte array before it can be decoded. `atob` is not
 * dependable across React Native runtimes and returns a binary string that then
 * needs a second pass anyway, so this decodes straight to a `Uint8Array`.
 *
 * It runs once per analysed frame on strings of a few kilobytes, so it is
 * written as a flat loop over a lookup table rather than anything clever.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup, indexed by char code. -1 marks a character to skip. */
const LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  // Accept the URL-safe variant too, since callers should not have to care.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

export function base64ToBytes(input: string): Uint8Array {
  // Strip a data URI prefix if one came along.
  const commaIndex = input.startsWith('data:') ? input.indexOf(',') : -1;
  const source = commaIndex >= 0 ? input.slice(commaIndex + 1) : input;

  // Upper bound: every 4 characters yield 3 bytes. Whitespace and padding only
  // ever make the real length smaller, so the buffer is trimmed at the end.
  const out = new Uint8Array(Math.ceil((source.length * 3) / 4));

  let outIndex = 0;
  let accumulator = 0;
  let bits = 0;

  for (let i = 0; i < source.length; i++) {
    const value = LOOKUP[source.charCodeAt(i)] ?? -1;
    // Padding, newlines and stray characters carry no data.
    if (value < 0) continue;

    accumulator = (accumulator << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (accumulator >> bits) & 0xff;
    }
  }

  return out.subarray(0, outIndex);
}
