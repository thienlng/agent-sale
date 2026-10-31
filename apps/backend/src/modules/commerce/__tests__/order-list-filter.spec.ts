import { OrderListQuery } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { phoneNeedles, toOrderListFilter } from '../application/order-list-filter.js';

const USER = '0b6f3f0e-6a55-4b1e-9b8e-2f1f4c0d9a11';
const map = (query: Record<string, string>) => toOrderListFilter(OrderListQuery.parse(query), {});

describe('orders list query → store filter', () => {
  it('splits the comma lists and keeps the defaults', () => {
    const f = map({
      source: 'facebook,zalo',
      carrier: 'GHN, GHTK',
      creator: `${USER},bot_approved`,
    });
    expect(f).toMatchObject({
      sources: ['facebook', 'zalo'],
      carriers: ['GHN', 'GHTK'],
      creators: [USER, 'bot_approved'],
      sort: 'placed_desc',
      offset: 0,
      limit: 20,
      money: {},
    });
  });

  it('maps the deprecated createdBy and review=pending into the creator list', () => {
    expect(map({ createdBy: USER }).creators).toEqual([USER]);
    expect(map({ review: 'pending' }).creators).toEqual(['bot_pending']);
    expect(map({ review: 'pending', creator: 'bot_pending' }).creators).toEqual(['bot_pending']);
    expect(map({}).creators).toBeUndefined();
  });

  it('folds column texts like q (accents, đ, case, spaces)', () => {
    const f = map({
      q: 'Đơn  Hàng',
      customer: 'Trần Văn Bình',
      address: 'Đà Nẵng',
      product: 'ÁO THUN',
      note: 'Giao  giờ hành chính',
      code: 'dh0001',
      tracking: 'GHN123',
    });
    expect(f.q).toBe('don hang');
    expect(f.text).toMatchObject({
      customer: 'tran van binh',
      address: 'da nang',
      product: 'ao thun',
      note: 'giao gio hanh chinh',
      code: 'dh0001',
      tracking: 'ghn123',
    });
  });

  it('keeps only the given money bounds', () => {
    const f = map({ totalMin: '100000', codMax: '0', grossMin: '1', grossMax: '2' });
    expect(f.money).toEqual({
      total: { min: 100_000, max: undefined },
      cod: { min: undefined, max: 0 },
      gross: { min: 1, max: 2 },
    });
  });

  it('pages and sorts', () => {
    expect(map({ sort: 'carrier_asc', page: '3', pageSize: '50' })).toMatchObject({
      sort: 'carrier_asc',
      offset: 100,
      limit: 50,
    });
  });

  it('turns a phone search into digit needles across the 0 / 84 prefixes', () => {
    expect(phoneNeedles('0901 234')).toEqual(['0901234', '84901234']);
    expect(phoneNeedles('+84 901-234')).toEqual(['84901234', '0901234']);
    expect(phoneNeedles('1234')).toEqual(['1234']);
    expect(phoneNeedles('84')).toEqual(['84']);
    expect(phoneNeedles('abc')).toEqual([]);
    expect(map({ phone: 'abc' }).text.phone).toEqual([]);
  });
});
