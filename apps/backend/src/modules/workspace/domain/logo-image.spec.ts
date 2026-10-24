import { describe, expect, it } from 'vitest';

import { inspectLogo } from './logo-image.js';

/** A minimal PNG: signature, IHDR with the given size, IEND (not a decodable picture, but a valid frame). */
function png(width: number, height = width): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, iend]);
}

/** A minimal JPEG: SOI, an APP0 segment, SOF0 with the size, EOI. */
function jpeg(width: number, height = width): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe('inspectLogo', () => {
  it('accepts square PNG and JPEG logos and reports their size', () => {
    expect(inspectLogo(png(720))).toEqual({
      ok: true,
      image: { mime: 'image/png', width: 720, height: 720 },
    });
    expect(inspectLogo(jpeg(512))).toEqual({
      ok: true,
      image: { mime: 'image/jpeg', width: 512, height: 512 },
    });
  });

  it('refuses anything that is not a decodable PNG or JPEG, whatever it is called', () => {
    expect(
      inspectLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
    ).toMatchObject({ reason: 'not_an_image' });
    expect(inspectLogo(Buffer.from('<html><body>hi</body></html>'))).toMatchObject({
      reason: 'not_an_image',
    });
    expect(inspectLogo(Buffer.from('GIF89a......'))).toMatchObject({ reason: 'not_an_image' });
    expect(inspectLogo(Buffer.alloc(0))).toMatchObject({ reason: 'not_an_image' });
    // Truncated files: valid start, no end.
    expect(inspectLogo(png(720).subarray(0, 30))).toMatchObject({ reason: 'corrupt' });
    expect(inspectLogo(jpeg(720).subarray(0, 12))).toMatchObject({ reason: 'corrupt' });
  });

  it('enforces size, squareness and side length with explicit reasons', () => {
    expect(inspectLogo(Buffer.concat([png(720), Buffer.alloc(1_048_576)]))).toMatchObject({
      reason: 'too_large',
    });
    expect(inspectLogo(png(720, 360))).toMatchObject({
      reason: 'not_square',
      width: 720,
      height: 360,
    });
    expect(inspectLogo(png(64))).toMatchObject({ reason: 'too_small' });
    expect(inspectLogo(png(4096))).toMatchObject({ reason: 'too_big' });
    expect(inspectLogo(jpeg(100, 50))).toMatchObject({ reason: 'not_square' });
  });
});
