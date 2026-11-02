import { notificationStrings } from '@agent-sales/i18n/notification';
import { describe, expect, it } from 'vitest';

import { formatVnd, renderReport, type ReportResult } from '../domain/report-render.js';

const vi = notificationStrings('vi');
const en = notificationStrings('en');
const day = { period: 'day', window: 'previous', from: '2026-11-01', to: '2026-11-01' } as const;

export const REPORT_FIXTURES: ReportResult[] = [
  {
    template: 'revenue_summary',
    mode: 'report',
    period: day,
    figures: {
      sales: 3_500_000,
      revenue: 1_250_000,
      closedOrders: 3,
      averageOrderValue: 416_667,
      profit: -20_000,
    },
  },
  {
    template: 'new_orders',
    mode: 'report',
    period: { period: 'week', window: 'previous', from: '2026-10-26', to: '2026-11-01' },
    figures: {
      count: 2,
      total: 450_000,
      latest: [
        { code: 'DH000012', total: 250_000 },
        { code: 'DH000011', total: 200_000 },
      ],
    },
  },
  {
    template: 'low_stock',
    mode: 'alert',
    threshold: 5,
    figures: {
      count: 2,
      items: [
        { product: 'Áo thun - Đỏ', sku: 'AT-D', available: 0 },
        { product: 'Mũ', sku: null, available: 3 },
      ],
    },
  },
  {
    template: 'unanswered_conversations',
    mode: 'alert',
    minutes: 30,
    figures: {
      count: 3,
      oldestMinutes: 95,
      byChannel: [
        { channel: 'facebook', count: 2 },
        { channel: 'website', count: 1 },
      ],
    },
  },
  {
    template: 'new_customers',
    mode: 'report',
    period: { period: 'month', window: 'to_date', from: '2026-11-01', to: '2026-11-02' },
    figures: {
      count: 4,
      bySource: [
        { source: 'Facebook', count: 3 },
        { source: null, count: 1 },
      ],
    },
  },
];

describe('formatVnd', () => {
  it('formats Vietnamese money', () => {
    expect(formatVnd(1_250_000)).toBe('1.250.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatVnd(-20_000)).toBe('-20.000 ₫');
    expect(formatVnd(999)).toBe('999 ₫');
  });
});

describe('renderReport', () => {
  it('renders every template in Vietnamese', () => {
    expect(REPORT_FIXTURES.map((r) => renderReport(r, vi, 'Shop Lan'))).toMatchSnapshot();
  });

  it('renders English and the empty cases', () => {
    const [revenue] = REPORT_FIXTURES;
    expect(renderReport(revenue!, en, 'Shop Lan').title).toBe(
      'Revenue yesterday (01/11) · Shop Lan',
    );
    const none = renderReport(
      { template: 'low_stock', mode: 'report', threshold: 5, figures: { count: 0, items: [] } },
      vi,
      'Shop Lan',
    );
    expect(none.body).toBe('Không có sản phẩm nào còn từ 5 trở xuống.');
    // Every placeholder is filled.
    for (const r of REPORT_FIXTURES) {
      for (const strings of [vi, en]) {
        const { title, body } = renderReport(r, strings, 'Shop');
        expect(`${title}\n${body}`).not.toMatch(/\{\{|report\.|period\./);
      }
    }
  });

  it('carries no customer fields (S3-R9)', () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k.toLowerCase());
          walk(x);
        }
      }
    };
    REPORT_FIXTURES.forEach(walk);
    for (const banned of [
      'name',
      'customer',
      'customername',
      'phone',
      'email',
      'message',
      'text',
    ]) {
      expect(keys.has(banned), banned).toBe(false);
    }
  });
});
