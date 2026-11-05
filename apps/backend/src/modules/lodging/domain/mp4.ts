/** MP4 brands Messenger and browsers play; `qt  ` (QuickTime .mov) is not one of them. */
const BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash']);

/** True when the bytes start with an ISO-BMFF `ftyp` box whose major brand is an MP4 brand. */
export function isMp4(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const ascii = (from: number) => String.fromCharCode(...bytes.subarray(from, from + 4));
  return ascii(4) === 'ftyp' && BRANDS.has(ascii(8));
}
