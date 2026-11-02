import { describe, expect, it } from 'vitest';

import { assistantRoutes } from './assistant.routes.js';
import {
  AssistantMemoryDto,
  AssistantMessageDto,
  AssistantPageContext,
  AssistantPageForm,
  AssistantProposalDto,
  AssistantUiAction,
  AssistantChart,
  SendAssistantMessageRequest,
  UpdateAssistantThreadRequest,
} from './assistant.schema.js';

const TURN = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';

describe('AssistantUiAction', () => {
  it('accepts an in-app navigate and a spotlight', () => {
    expect(AssistantUiAction.safeParse({ type: 'navigate', to: '/app/bots' }).success).toBe(true);
    expect(
      AssistantUiAction.safeParse({ type: 'spotlight', target: 'bot.save', hint: 'Bấm Lưu' })
        .success,
    ).toBe(true);
  });

  it('rejects navigating outside the app', () => {
    expect(AssistantUiAction.safeParse({ type: 'navigate', to: 'https://evil.test' }).success).toBe(
      false,
    );
  });
});

describe('UpdateAssistantThreadRequest', () => {
  it('rejects an empty update', () => {
    expect(UpdateAssistantThreadRequest.safeParse({}).success).toBe(false);
  });

  it('accepts a partial update', () => {
    expect(UpdateAssistantThreadRequest.parse({ pinned: true })).toEqual({ pinned: true });
  });
});

describe('SendAssistantMessageRequest', () => {
  it('trims the text', () => {
    expect(SendAssistantMessageRequest.parse({ turnId: TURN, text: '  hello  ' }).text).toBe(
      'hello',
    );
  });

  it('rejects whitespace-only text', () => {
    expect(SendAssistantMessageRequest.safeParse({ turnId: TURN, text: '   ' }).success).toBe(
      false,
    );
  });
});

describe('AssistantMessageDto', () => {
  it('never carries tool rows', () => {
    const msg = {
      id: TURN,
      seq: 1,
      role: 'tool',
      content: '{}',
      uiActions: [],
      runId: null,
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    expect(AssistantMessageDto.safeParse(msg).success).toBe(false);
    expect(AssistantMessageDto.safeParse({ ...msg, role: 'event' }).success).toBe(true);
  });
});

describe('assistantRoutes', () => {
  it('declares the eleven workspace-scoped assistant routes', () => {
    expect(assistantRoutes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'get /assistant/threads',
      'post /assistant/threads',
      'patch /assistant/threads/{threadId}',
      'get /assistant/threads/{threadId}/messages',
      'post /assistant/threads/{threadId}/messages',
      'get /assistant/runs/{runId}',
      'get /assistant/memory',
      'delete /assistant/memory/{store}/entries/{entryId}',
      'get /assistant/threads/{threadId}/proposals',
      'post /assistant/proposals/{proposalId}/approve',
      'post /assistant/proposals/{proposalId}/reject',
    ]);
    for (const r of assistantRoutes) {
      expect(r).toMatchObject({
        tag: 'assistant',
        auth: true,
        workspaceScoped: true,
        assistant: { use: 'never' },
      });
    }
  });
});

describe('AssistantPageForm', () => {
  const field = { name: 'price', label: 'Giá bán', type: 'number', empty: true } as const;

  it('accepts a form with typed fields and select options', () => {
    const form = {
      id: 'product.form',
      fields: [
        field,
        { name: 'unit', label: 'Đơn vị', type: 'select', options: ['cái', 'hộp'], empty: false },
      ],
    };
    expect(AssistantPageForm.safeParse(form).success).toBe(true);
    expect(
      AssistantPageContext.safeParse({ route: '/app/products/new', forms: [form] }).success,
    ).toBe(true);
  });

  it('rejects an unknown field type, a missing `empty` flag and more than 30 fields', () => {
    expect(
      AssistantPageForm.safeParse({ id: 'f', fields: [{ ...field, type: 'date' }] }).success,
    ).toBe(false);
    expect(
      AssistantPageForm.safeParse({ id: 'f', fields: [{ name: 'a', label: 'A', type: 'text' }] })
        .success,
    ).toBe(false);
    expect(
      AssistantPageForm.safeParse({ id: 'f', fields: Array.from({ length: 31 }, () => field) })
        .success,
    ).toBe(false);
  });

  it('caps the page at 5 forms', () => {
    const forms = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, fields: [] }));
    expect(AssistantPageContext.safeParse({ route: '/app', forms }).success).toBe(false);
  });
});

describe('fill_form action', () => {
  it('accepts string and number values', () => {
    expect(
      AssistantUiAction.safeParse({
        type: 'fill_form',
        formId: 'product.form',
        values: { name: 'Áo thun', price: 150000 },
      }).success,
    ).toBe(true);
  });

  it('rejects other value types, a long value and a long form id', () => {
    const base = { type: 'fill_form', formId: 'product.form' };
    expect(AssistantUiAction.safeParse({ ...base, values: { active: true } }).success).toBe(false);
    expect(
      AssistantUiAction.safeParse({ ...base, values: { notes: 'x'.repeat(4001) } }).success,
    ).toBe(false);
    expect(
      AssistantUiAction.safeParse({ ...base, formId: 'f'.repeat(61), values: {} }).success,
    ).toBe(false);
  });

  it('accepts at most 30 values, like a form', () => {
    const values = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, i]));
    const base = { type: 'fill_form', formId: 'product.form' };
    expect(AssistantUiAction.safeParse({ ...base, values: values(30) }).success).toBe(true);
    expect(AssistantUiAction.safeParse({ ...base, values: values(31) }).success).toBe(false);
  });
});

describe('chart action', () => {
  const chart = {
    kind: 'bar',
    title: 'Doanh thu 7 ngày',
    x: { key: 'day', label: 'Ngày' },
    series: [{ key: 'revenue', label: 'Doanh thu' }],
    unit: 'vnd',
    rows: [
      { day: '2026-11-01', revenue: 1_250_000 },
      { day: '2026-11-02', revenue: null },
    ],
  };

  it('parses a chart action', () => {
    expect(AssistantUiAction.safeParse({ type: 'chart', chart }).success).toBe(true);
  });

  it('still parses the older actions next to it', () => {
    const actions = [
      { type: 'navigate', to: '/app/orders' },
      { type: 'chart', chart },
      { type: 'spotlight', target: 'orders.new', hint: 'Ở đây' },
    ];
    expect(actions.every((a) => AssistantUiAction.safeParse(a).success)).toBe(true);
  });

  it('accepts a pie with one series and up to 12 rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ day: `d${i}`, revenue: i }));
    expect(AssistantChart.safeParse({ ...chart, kind: 'pie', rows }).success).toBe(true);
  });

  it('rejects a pie with 2 series or 13 rows', () => {
    const two = [...chart.series, { key: 'profit', label: 'Lợi nhuận' }];
    expect(AssistantChart.safeParse({ ...chart, kind: 'pie', series: two }).success).toBe(false);
    const rows = Array.from({ length: 13 }, (_, i) => ({ day: `d${i}`, revenue: i }));
    expect(AssistantChart.safeParse({ ...chart, kind: 'pie', rows }).success).toBe(false);
    // The same two series are fine on a bar chart.
    expect(AssistantChart.safeParse({ ...chart, series: two }).success).toBe(true);
  });

  it('rejects 61 rows, 5 series, no series, a long cell and a bad unit', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ day: `d${i}`, revenue: i }));
    expect(AssistantChart.safeParse({ ...chart, rows: rows(60) }).success).toBe(true);
    expect(AssistantChart.safeParse({ ...chart, rows: rows(61) }).success).toBe(false);
    const series = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `s${i}`, label: 'S' }));
    expect(AssistantChart.safeParse({ ...chart, series: series(5) }).success).toBe(false);
    expect(AssistantChart.safeParse({ ...chart, series: series(0) }).success).toBe(false);
    expect(
      AssistantChart.safeParse({ ...chart, rows: [{ day: 'x'.repeat(81), revenue: 1 }] }).success,
    ).toBe(false);
    expect(AssistantChart.safeParse({ ...chart, rows: [{ day: true, revenue: 1 }] }).success).toBe(
      false,
    );
    expect(AssistantChart.safeParse({ ...chart, unit: 'usd' }).success).toBe(false);
    expect(AssistantChart.safeParse({ ...chart, title: 't'.repeat(121) }).success).toBe(false);
  });
});

describe('proposal and memory DTOs', () => {
  const now = '2026-11-02T10:00:00.000Z';

  it('parses a pending proposal and rejects an unknown status', () => {
    const proposal = {
      id: TURN,
      threadId: TURN,
      businessId: TURN,
      routeKey: 'PATCH /products/{productId}',
      summary: 'Đổi giá áo thun',
      preview: { price: { from: 120000, to: 150000 } },
      status: 'pending',
      errorCode: null,
      createdAt: now,
      expiresAt: now,
      decidedAt: null,
    };
    expect(AssistantProposalDto.safeParse(proposal).success).toBe(true);
    expect(AssistantProposalDto.safeParse({ ...proposal, status: 'approved' }).success).toBe(false);
  });

  it('parses memory stores with entries', () => {
    expect(
      AssistantMemoryDto.safeParse({
        stores: [
          {
            store: 'notes',
            label: 'Ghi chú',
            limit: 2200,
            used: 12,
            entries: [{ id: 'e1', text: 'Shop nghỉ Chủ nhật', createdAt: now }],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
