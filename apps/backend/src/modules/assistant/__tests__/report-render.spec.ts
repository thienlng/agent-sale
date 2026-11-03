import { notificationStrings } from '@agent-sales/i18n/notification';
import { describe, expect, it, vi as mock } from 'vitest';

import { ReportService } from '../application/report.service.js';
import type { ReportDataSource } from '../domain/ports/report-data-source.port.js';
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

describe('revenue report of a hotel (QA Villas #6)', () => {
  const orders = {
    sales: 0,
    revenue: 0,
    closedOrders: 0,
    averageOrderValue: 0,
    profit: 0,
  };
  const data = (industry: string): ReportDataSource => ({
    revenue: mock.fn(async () => orders),
    orders: mock.fn(async () => ({ count: 0, total: 0, latest: [] })),
    lowStock: mock.fn(async () => ({ count: 0, items: [], ids: [] })),
    awaiting: mock.fn(async () => ({ count: 0, oldestSince: null, byChannel: [], ids: [] })),
    newContacts: mock.fn(async () => ({ count: 0, bySource: [] })),
    industry: mock.fn(async () => industry),
    stays: mock.fn(async () => ({
      bookings: 2,
      nights: 4,
      revenue: 63_000_000,
      profit: 7_000_000,
    })),
  });
  const spec = {
    businessId: 'b1',
    template: 'revenue_summary' as const,
    mode: 'report' as const,
    params: { period: 'week', window: 'previous' },
  };
  const NOW = new Date('2026-11-03T01:00:00.000Z');

  it('reports the stays of the period, not the orders, for a hotel', async () => {
    const source = data('hotel');
    const reports = new ReportService(source, () => vi);
    const { result } = await reports.compute(spec, NOW);
    expect(source.stays).toHaveBeenCalledWith('b1', '2026-10-26', '2026-11-01');
    expect(result).toMatchObject({
      template: 'revenue_summary',
      stays: { bookings: 2, nights: 4, revenue: 63_000_000, profit: 7_000_000 },
    });
    const { title, body } = reports.render(result, 'vi', 'Villas');
    expect(title).toBe('Doanh thu lưu trú tuần trước (26/10 – 01/11) · Villas');
    expect(body).toBe(
      'Doanh thu lưu trú: 63.000.000 ₫\nSố đêm đã bán: 4\nLượt đặt: 2\nLợi nhuận: 7.000.000 ₫',
    );
    expect(renderReport(result, en, 'Villas').body).toContain('Nights sold: 4');
  });

  it('keeps the order report for a shop', async () => {
    const source = data('retail');
    const { result } = await new ReportService(source, () => vi).compute(spec, NOW);
    expect(source.stays).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('stays');
  });
});
