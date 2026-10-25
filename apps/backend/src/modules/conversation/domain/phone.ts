/**
 * Vietnamese mobile numbers in customer text: `0xxxxxxxxx`, `+84xxxxxxxxx` and `84xxxxxxxxx`,
 * with spaces, dots or dashes between digits. Landlines and longer digit runs (order codes,
 * bank accounts) are ignored on purpose: a wrong phone on a sales card is worse than none.
 */
const CANDIDATE = /(?<![\d+])(\+?84|0)((?:[ .-]?\d){9})(?!\d)/g;

/** The last mobile number found in `text`, normalized to `0xxxxxxxxx`, or `null`. */
export function detectVietnamesePhone(text: string): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(CANDIDATE)) {
    const national = (match[2] ?? '').replace(/\D/g, '');
    // Mobile ranges: 03x, 05x, 07x, 08x, 09x.
    if (/^[35789]/.test(national)) found = `0${national}`;
  }
  return found;
}
