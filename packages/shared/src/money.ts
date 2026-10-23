/**
 * Money helpers. Amounts are integers in VND (no minor units); credits are
 * integers in milli-credits (1 credit = 1,000 VND = 1,000 milli-credits).
 * See docs/adr/ADR-008-credit-ledger.md.
 */

export const MILLI_CREDITS_PER_CREDIT = 1_000;
export const VND_PER_CREDIT = 1_000;

/** Formats an integer VND amount the way Vietnamese users read it: `125.000đ`. */
export function formatVnd(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`VND amounts must be integers, got ${amount}`);
  }
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${digits}đ`;
}

/** Converts a VND price into milli-credits (1 VND = 1 milli-credit). */
export function vndToMilliCredits(amountVnd: number): number {
  if (!Number.isInteger(amountVnd) || amountVnd < 0) {
    throw new RangeError(`amountVnd must be a non-negative integer, got ${amountVnd}`);
  }
  return amountVnd;
}

/** Formats milli-credits as credits with up to 3 decimals: 110 → `0.11`, 1500 → `1.5`. */
export function formatCredits(milliCredits: number): string {
  if (!Number.isInteger(milliCredits)) {
    throw new TypeError(`milliCredits must be an integer, got ${milliCredits}`);
  }
  const credits = milliCredits / MILLI_CREDITS_PER_CREDIT;
  return credits.toFixed(3).replace(/\.?0+$/, '');
}
