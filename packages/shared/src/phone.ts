/**
 * Vietnamese phone number normalization. Contacts are stored in E.164
 * (`+84xxxxxxxxx`) and displayed as `0xxxxxxxxx`. See docs/05-data-model.md §9.
 */

const VN_MOBILE_PREFIXES = /^(3[2-9]|5[2689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;

/** Legacy 3-digit mobile prefixes (after the leading 0) and the 2-digit prefix that replaced them. */
const LEGACY_MOBILE_PREFIXES: Readonly<Record<string, string>> = {
  '162': '32',
  '163': '33',
  '164': '34',
  '165': '35',
  '166': '36',
  '167': '37',
  '168': '38',
  '169': '39',
  '120': '70',
  '121': '79',
  '122': '77',
  '126': '76',
  '128': '78',
  '123': '83',
  '124': '84',
  '125': '85',
  '127': '81',
  '129': '82',
  '186': '56',
  '188': '58',
  '199': '59',
};

/** Numbers people type to get past a form; never a real lead (national form). */
export const PLACEHOLDER_PHONES: readonly string[] = [
  '0987654321',
  '0123456789',
  '0909090909',
  '0912345678',
  '0000000000',
  '1234567890',
];

/**
 * Normalizes user input to E.164 for Vietnam. Accepts `0912345678`,
 * `84912345678`, `+84 912 345 678`, `(+84)912-345-678`. Returns `null` when the
 * input is not a valid Vietnamese mobile number.
 */
export function normalizeVnPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  // Legacy 11-digit mobiles (0168… → 038…) became 10 digits in 2018.
  if (digits.length === 11 && digits.startsWith('0')) {
    const modern = LEGACY_MOBILE_PREFIXES[digits.slice(1, 4)];
    if (modern) digits = `0${modern}${digits.slice(4)}`;
  }
  let national: string;
  if (digits.startsWith('84') && digits.length === 11) {
    national = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 10) {
    national = digits.slice(1);
  } else if (digits.length === 9) {
    national = digits;
  } else {
    return null;
  }
  return VN_MOBILE_PREFIXES.test(national) ? `+84${national}` : null;
}

/**
 * Like normalizeVnPhone but also rejects placeholder numbers. Used wherever a
 * number comes from an anonymous visitor (lead capture, widget phone field).
 */
export function normalizeLeadPhone(input: string): string | null {
  const e164 = normalizeVnPhone(input);
  if (!e164) return null;
  return PLACEHOLDER_PHONES.includes(`0${e164.slice(3)}`) ? null : e164;
}

/**
 * First valid Vietnamese mobile number in free text (`+84`, `84`, spaces, dots,
 * dashes allowed), as E.164. No regex lookbehind: the widget bundles this.
 */
export function findVnPhone(text: string): string | null {
  const candidates = text.match(/\+?\d(?:[\s.\-()]?\d)+/g) ?? [];
  for (const candidate of candidates) {
    const whole = normalizeLeadPhone(candidate);
    if (whole) return whole;
    // "mua 2 0912345679": a quantity glued to the number by a space. Try runs of adjacent digit groups.
    const groups = candidate.split(/[\s.\-()]+/).filter(Boolean);
    for (let from = 0; from < groups.length; from++) {
      for (let to = groups.length; to > from; to--) {
        if (from === 0 && to === groups.length) continue;
        const phone = normalizeLeadPhone(groups.slice(from, to).join(''));
        if (phone) return phone;
      }
    }
  }
  return null;
}

/** Formats an E.164 Vietnamese number for display: `+84912345678` → `0912345678`. */
export function formatVnPhone(e164: string): string {
  if (!e164.startsWith('+84') || e164.length !== 12) {
    throw new RangeError(`not a Vietnamese E.164 number: ${e164}`);
  }
  return `0${e164.slice(3)}`;
}

/** Masks a phone number for logs: `+84912345678` → `+84912***678`. */
export function maskPhone(e164: string): string {
  return e164.length < 7 ? '***' : `${e164.slice(0, 6)}***${e164.slice(-3)}`;
}

/**
 * Normalizes any usable phone input to E.164: Vietnamese mobiles via
 * normalizeVnPhone, other numbers written with a `+` country code as `+digits`
 * (8–15 digits). Returns null for anything else (e.g. a Vietnamese landline
 * without `+84`, or text). Used for customer identity and duplicate detection.
 */
export function normalizeAnyPhone(input: string): string | null {
  const vn = normalizeVnPhone(input);
  if (vn) return vn;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  return /^\+|^\(\+/.test(trimmed) && digits.length >= 8 && digits.length <= 15
    ? `+${digits}`
    : null;
}

/** Lower-cased, trimmed email for identity and duplicate checks. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
