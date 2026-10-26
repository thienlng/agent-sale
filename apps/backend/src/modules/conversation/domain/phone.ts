/**
 * Vietnamese mobile numbers in customer text: `0xxxxxxxxx`, `+84xxxxxxxxx` and `84xxxxxxxxx`,
 * written with at most one kind of separator (space, dot or dash) between digits. Landlines,
 * dates, prices, order codes and longer digit runs are ignored on purpose: a wrong phone on a
 * sales card is worse than none.
 */
// Not glued to a letter, digit or "+", and not the tail of a dotted/dashed number ("1.0912…").
const CANDIDATE = /(?<![\p{L}\d+])(?<!\d[.-])(\+?84|0)((?:[ .-]?\d){9})(?![ .-]?\d)/gu;

/** The digits after the country/trunk prefix when `body` has one consistent separator style. */
function nationalDigits(body: string): string | null {
  const separators = new Set(body.replace(/\d/g, ''));
  return separators.size <= 1 ? body.replace(/\D/g, '') : null;
}

/** The last mobile number found in `text`, normalized to `0xxxxxxxxx`, or `null`. */
export function detectVietnamesePhone(text: string): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(CANDIDATE)) {
    const national = nationalDigits(match[2] ?? '');
    // Mobile ranges: 03x, 05x, 07x, 08x, 09x.
    if (national && /^[35789]/.test(national)) found = `0${national}`;
  }
  return found;
}

/** `0xxxxxxxxx` for a string that is exactly one phone number, else `null` (staff corrections). */
export function normalizeVietnamesePhone(input: string): string | null {
  const text = input.trim();
  const phone = detectVietnamesePhone(text);
  if (!phone) return null;
  return text.replace(/[\s.+()-]/g, '').replace(/^84/, '0') === phone ? phone : null;
}
