import { describe, expect, it } from 'vitest';

import { newPaymentCode, paidPeriod, paymentAmount, vietQrUrl } from './payment.js';
import { addMonths, assertArchivable, assertPlanBody, mrrVnd } from './plan-catalog.js';

const plan = { code: 'sales_pro', priceByPeriod: { '3': 1_624_000, '12': 974_000 } };
const now = new Date('2026-11-10T00:00:00Z');

describe('payments', () => {
  it('codes are RPZ + 6 unambiguous base32 characters', () => {
    expect(newPaymentCode()).toMatch(/^RPZ[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('defaults the amount to the monthly price × months', () => {
    expect(paymentAmount(plan, 3, undefined)).toBe(4_872_000);
    expect(paymentAmount(plan, 3, 4_000_000)).toBe(4_000_000);
    expect(() => paymentAmount(plan, 6, undefined)).toThrow('no price');
  });

  it('extends from the end of the paid period when paying early', () => {
    const end = new Date('2026-12-01T00:00:00Z');
    expect(
      paidPeriod({ status: 'active', periodMonths: 3, currentPeriodEnd: end }, 3, now),
    ).toEqual({
      start: end,
      end: new Date('2027-03-01T00:00:00Z'),
    });
    // A trial is not paid time: the period starts now.
    expect(
      paidPeriod({ status: 'trialing', periodMonths: null, currentPeriodEnd: end }, 1, now).start,
    ).toEqual(now);
    expect(paidPeriod(null, 1, now).start).toEqual(now);
  });

  it('builds the VietQR quick link, or null without a bank account', () => {
    expect(
      vietQrUrl(
        { bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'CONG TY RAPIZ' },
        4_872_000,
        'RPZABC123',
      ),
    ).toBe(
      'https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=4872000&addInfo=RPZABC123&accountName=CONG+TY+RAPIZ',
    );
    expect(
      vietQrUrl({ bankBin: null, bankAccountNo: null, bankAccountName: null }, 1, 'X'),
    ).toBeNull();
  });
});

describe('plan catalog rules', () => {
  it('computes MRR from the monthly price of the period, 0 on trial and free', () => {
    expect(mrrVnd(plan, { status: 'active', periodMonths: 12 })).toBe(974_000);
    expect(mrrVnd(plan, { status: 'trialing', periodMonths: null })).toBe(0);
    expect(mrrVnd(plan, { status: 'suspended', periodMonths: 3 })).toBe(0);
  });

  it('clamps calendar months to the last day', () => {
    expect(addMonths(new Date('2026-01-31T05:00:00Z'), 1)).toEqual(
      new Date('2026-02-28T05:00:00Z'),
    );
  });

  it('keeps the free plan public and without prices', () => {
    const body = {
      name: 'Free',
      description: '',
      isPublic: true,
      sortOrder: 0,
      priceByPeriod: {},
      entitlements: {},
    };
    expect(() => assertPlanBody('free', body)).not.toThrow();
    expect(() => assertPlanBody('free', { ...body, priceByPeriod: { '1': 1 } })).toThrow();
    expect(() => assertPlanBody('free', { ...body, isPublic: false })).toThrow();
  });

  it('refuses to archive the free plan or a plan the settings use', () => {
    const settings = { trialPlanCode: 'sales_pro', afterTrialPlanCode: 'free' };
    expect(() => assertArchivable('free', settings)).toThrow();
    expect(() => assertArchivable('sales_pro', settings)).toThrow('trial plan');
    expect(() => assertArchivable('sales_neo', settings)).not.toThrow();
  });
});
