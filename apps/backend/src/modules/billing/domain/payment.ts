import { randomInt } from 'node:crypto';

import { addMonths, monthlyPrice } from './plan-catalog.js';
import { PlanRuleError } from './billing.errors.js';

/** Crockford base32 without I, L, O, U: easy to type in a bank transfer note. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Transfer content of a payment: `RPZ` + 6 base32 characters (about 1 billion codes). */
export function newPaymentCode(): string {
  let code = 'RPZ';
  for (let i = 0; i < 6; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** The amount to transfer: the plan's monthly price for the period × months, unless given. */
export function paymentAmount(
  plan: { code: string; priceByPeriod: Record<string, number> },
  periodMonths: number,
  amountVnd: number | undefined,
): number {
  if (amountVnd !== undefined) return amountVnd;
  const monthly = monthlyPrice(plan, periodMonths);
  if (monthly === null) {
    throw new PlanRuleError('The plan has no price for this period', {
      code: plan.code,
      periodMonths,
    });
  }
  return monthly * periodMonths;
}

/**
 * A confirmed payment extends the paid time: the new period starts now, or at the end of the
 * current paid period when that is later (paying early loses no day). Trials do not count.
 */
export function paidPeriod(
  current: { status: string; periodMonths: number | null; currentPeriodEnd: Date | null } | null,
  periodMonths: number,
  now: Date,
): { start: Date; end: Date } {
  const paidEnd =
    current &&
    current.periodMonths !== null &&
    (current.status === 'active' || current.status === 'past_due') &&
    current.currentPeriodEnd
      ? current.currentPeriodEnd
      : null;
  const start = paidEnd && paidEnd.getTime() > now.getTime() ? paidEnd : now;
  return { start, end: addMonths(start, periodMonths) };
}

export interface BankAccount {
  bankBin: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
}

/** VietQR image for the transfer (img.vietqr.io quick link), or null without a bank account. */
export function vietQrUrl(bank: BankAccount, amountVnd: number, code: string): string | null {
  if (!bank.bankBin || !bank.bankAccountNo) return null;
  const params = new URLSearchParams({ amount: String(amountVnd), addInfo: code });
  if (bank.bankAccountName) params.set('accountName', bank.bankAccountName);
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankBin)}-${encodeURIComponent(
    bank.bankAccountNo,
  )}-compact2.png?${params.toString()}`;
}
