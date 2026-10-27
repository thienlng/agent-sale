import { describe, expect, it } from 'vitest';
import { sniffUpload } from '../domain/image-sniff.js';

const bytes = (...v: number[]) => Uint8Array.from([...v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('sniffUpload', () => {
  it('recognises the four accepted formats by signature', () => {
    expect(sniffUpload(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffUpload(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffUpload(Buffer.from('GIF89a\0\0\0\0\0\0\0\0'))).toBe('image/gif');
    expect(sniffUpload(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('rejects everything else, including scripts and svg', () => {
    expect(sniffUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffUpload(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffUpload(new Uint8Array())).toBeNull();
  });
});
