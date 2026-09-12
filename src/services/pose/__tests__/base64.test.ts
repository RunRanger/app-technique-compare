import { base64ToBytes } from '@/services/pose/base64';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('base64ToBytes', () => {
  it('decodes ASCII round-trips', () => {
    // "Man" -> "TWFu", the canonical no-padding case.
    expect(Array.from(base64ToBytes('TWFu'))).toEqual([77, 97, 110]);
  });

  it('handles one and two padding characters', () => {
    expect(Array.from(base64ToBytes('TWE='))).toEqual([77, 97]);
    expect(Array.from(base64ToBytes('TQ=='))).toEqual([77]);
  });

  it('returns an empty array for empty input', () => {
    expect(base64ToBytes('').length).toBe(0);
  });

  it('decodes binary bytes including 0x00 and 0xff', () => {
    // Buffer is available under Node and gives an independent reference.
    const original = bytes(0, 1, 127, 128, 254, 255, 0, 42);
    const encoded = Buffer.from(original).toString('base64');
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(original));
  });

  it('matches Node for a JPEG-sized random payload', () => {
    const original = new Uint8Array(4096);
    for (let i = 0; i < original.length; i++) original[i] = (i * 37 + 11) % 256;
    const encoded = Buffer.from(original).toString('base64');
    const decoded = base64ToBytes(encoded);
    expect(decoded.length).toBe(original.length);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('ignores newlines that some encoders insert', () => {
    const original = bytes(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const wrapped = Buffer.from(original).toString('base64').replace(/(.{4})/g, '$1\n');
    expect(Array.from(base64ToBytes(wrapped))).toEqual(Array.from(original));
  });

  it('strips a data URI prefix', () => {
    const encoded = Buffer.from(bytes(9, 8, 7)).toString('base64');
    expect(Array.from(base64ToBytes(`data:image/jpeg;base64,${encoded}`))).toEqual([9, 8, 7]);
  });

  it('accepts the URL-safe alphabet', () => {
    const original = bytes(255, 239, 190);
    const standard = Buffer.from(original).toString('base64');
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_');
    expect(Array.from(base64ToBytes(urlSafe))).toEqual(Array.from(original));
  });

  it('does not return trailing zero padding from the over-allocated buffer', () => {
    const original = bytes(1, 2);
    const decoded = base64ToBytes(Buffer.from(original).toString('base64'));
    expect(decoded.length).toBe(2);
  });
});
