import { describe, expect, it } from 'vitest';

import { decodeImage, InvalidImageError, verifyImageBytes } from './image-bytes.js';

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8, 1)]);

describe('decodeImage', () => {
  it('accepts a PNG whose signature matches the declared mime', () => {
    expect(decodeImage(png.toString('base64'), 'image/png')).toHaveLength(png.length);
  });

  it('rejects a mismatched signature or non-canonical base64', () => {
    expect(() => decodeImage(png.toString('base64'), 'image/jpeg')).toThrow(InvalidImageError);
    expect(() => decodeImage('not base64!', 'image/png')).toThrow(InvalidImageError);
  });

  it('enforces the size limit parameter (default 1 MiB)', () => {
    expect(() => decodeImage(png.toString('base64'), 'image/png', 10)).toThrow(InvalidImageError);
    const big = Buffer.concat([png, Buffer.alloc(1_048_576)]);
    expect(() => decodeImage(big.toString('base64'), 'image/png')).toThrow(InvalidImageError);
  });
});

describe('verifyImageBytes', () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  it('names the real format and rejects other bytes or oversize input', () => {
    expect(verifyImageBytes(png)).toBe('image/png');
    expect(() => verifyImageBytes(Buffer.from('<html></html>'))).toThrow();
    expect(() => verifyImageBytes(png, 4)).toThrow();
    expect(() => verifyImageBytes(new Uint8Array())).toThrow();
  });
});

describe('sniffImageMime', () => {
  it('accepts a JPEG by its start marker even with trailing bytes', () => {
    expect(verifyImageBytes(Uint8Array.from([255, 216, 255, 224, 1, 2, 0, 0]))).toBe('image/jpeg');
  });
});
