import { deflateSync } from 'node:zlib';

/** Real, decodable PNG fixtures (same generator as the backend integration tests). */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A real, decodable grayscale PNG of `width × height`; `noise` makes it incompressible (big files). */
export function makePng(width: number, height = width, noise = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const rows = Buffer.alloc((width + 1) * height);
  if (noise) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++)
        rows[y * (width + 1) + 1 + x] = (x * 131 + y * 71 + ((x * y) % 251)) & 0xff;
    }
  } else {
    for (let y = 0; y < height; y++) rows.fill(0x80, y * (width + 1) + 1, (y + 1) * (width + 1));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: noise ? 0 : 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
