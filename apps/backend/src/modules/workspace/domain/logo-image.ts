import { LOGO_RULES } from '@agent-sales/contracts';

export type LogoRejection =
  'too_large' | 'not_an_image' | 'corrupt' | 'not_square' | 'too_small' | 'too_big';

export interface LogoImage {
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** JPEG start-of-frame markers (baseline, extended, progressive, lossless…): they carry the size. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function png(b: Buffer): { width: number; height: number } | null {
  // signature, then IHDR (length 13) with width and height, and a closing IEND chunk.
  if (b.length < 33 || b.readUInt32BE(8) !== 13 || b.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  const tail = b.subarray(b.length - 12);
  if (tail.readUInt32BE(0) !== 0 || tail.toString('ascii', 4, 8) !== 'IEND') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpeg(b: Buffer): { width: number; height: number } | null {
  if (b.length < 4 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] as number;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      if (i + 9 > b.length) return null;
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) return null; // image data before any frame header
    i += 2 + length;
  }
  return null;
}

/**
 * Validates a logo from its bytes alone (never the file name or the declared
 * type): PNG or JPEG, at most 1 MiB, a decodable header with real dimensions,
 * square and within the allowed side lengths. Anything else (SVG, HTML, GIF,
 * a renamed file) is refused; nothing is resized, so the stored bytes are the
 * validated bytes.
 */
export function inspectLogo(
  bytes: Buffer,
):
  | { ok: true; image: LogoImage }
  | { ok: false; reason: LogoRejection; width?: number; height?: number } {
  if (bytes.length > LOGO_RULES.maxBytes) return { ok: false, reason: 'too_large' };
  let mime: LogoImage['mime'];
  let size: { width: number; height: number } | null;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG)) {
    mime = 'image/png';
    size = png(bytes);
  } else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mime = 'image/jpeg';
    size = jpeg(bytes);
  } else {
    return { ok: false, reason: 'not_an_image' };
  }
  if (!size || size.width < 1 || size.height < 1) return { ok: false, reason: 'corrupt' };
  const { width, height } = size;
  if (width !== height) return { ok: false, reason: 'not_square', width, height };
  if (width < LOGO_RULES.minSide) return { ok: false, reason: 'too_small', width, height };
  if (width > LOGO_RULES.maxSide) return { ok: false, reason: 'too_big', width, height };
  return { ok: true, image: { mime, width, height } };
}
