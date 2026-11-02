import { describe, expect, it } from 'vitest';

import { assistantRoutes } from './assistant.routes.js';
import {
  AcceptAssistantSuggestionResponse,
  AssistantMessageFeedbackRequest,
  UpdateAssistantSettingsRequest,
  AssistantLearningFeed,
  AssistantLearningQuery,
  AssistantMemoryDto,
  AssistantMessageDto,
  AssistantPageContext,
  AssistantPageForm,
  AssistantProposalDto,
  AssistantUiAction,
  AssistantChart,
  CreateAssistantSkillRequest,
  SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  UpdateAssistantSkillRequest,
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

  it('accepts pasted API docs up to 12 000 chars', () => {
    const ok = (n: number) =>
      SendAssistantMessageRequest.safeParse({ turnId: TURN, text: 'a'.repeat(n) }).success;
    expect(ok(11_000)).toBe(true);
    expect(ok(12_000)).toBe(true);
    expect(ok(12_001)).toBe(false);
  });
});

describe('SendAssistantMessageResponse', () => {
  it('defaults secretsRemoved to false', () => {
    const run = { id: TURN, status: 'done', outcome: 'done', rounds: 1, latencyMs: 5, steps: [] };
    expect(SendAssistantMessageResponse.parse({ messages: [], run }).secretsRemoved).toBe(false);
    expect(
      SendAssistantMessageResponse.parse({ messages: [], run, secretsRemoved: true })
        .secretsRemoved,
    ).toBe(true);
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
      feedback: null,
      createdAt: '2026-11-02T00:00:00.000Z',
    };
    expect(AssistantMessageDto.safeParse(msg).success).toBe(false);
    expect(AssistantMessageDto.safeParse({ ...msg, role: 'event' }).success).toBe(true);
  });
});

describe('assistantRoutes', () => {
  it('declares the workspace-scoped assistant routes, all `never`', () => {
    expect(assistantRoutes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'get /assistant/threads',
      'post /assistant/threads',
      'patch /assistant/threads/{threadId}',
      'get /assistant/threads/{threadId}/messages',
      'post /assistant/threads/{threadId}/messages',
      'get /assistant/runs/{runId}',
      'get /assistant/memory',
      'get /assistant/learning',
      'delete /assistant/memory/{store}/entries/{entryId}',
      'post /assistant/memory/{store}/entries/{entryId}/undo',
      'get /assistant/threads/{threadId}/proposals',
      'post /assistant/proposals/{proposalId}/approve',
      'post /assistant/proposals/{proposalId}/reject',
      'post /assistant/threads/{threadId}/imports',
      'get /assistant/imports/{batchId}',
      'get /assistant/skills',
      'get /assistant/skills/{skillRef}',
      'post /assistant/skills',
      'patch /assistant/skills/{skillId}',
      'delete /assistant/skills/{skillId}',
      'post /assistant/skills/{skillId}/approve',
      'post /assistant/skills/{skillId}/reject',
      'post /assistant/skills/{skillId}/archive',
      'post /assistant/skills/{skillId}/restore',
      'post /assistant/skills/platform/{name}/shadow',
      'get /assistant/skills/{skillId}/events',
      'post /assistant/skill-events/{eventId}/undo',
      'get /assistant/settings',
      'patch /assistant/settings',
      'post /assistant/messages/{messageId}/feedback',
      'get /assistant/suggestions',
      'post /assistant/suggestions/{suggestionId}/accept',
      'post /assistant/suggestions/{suggestionId}/dismiss',
      'get /assistant/schedules',
      'post /assistant/schedules',
      'post /assistant/schedules/preview',
      'patch /assistant/schedules/{scheduleId}',
      'post /assistant/schedules/{scheduleId}/pause',
      'post /assistant/schedules/{scheduleId}/resume',
      'post /assistant/schedules/{scheduleId}/run',
      'delete /assistant/schedules/{scheduleId}',
      'get /assistant/schedules/{scheduleId}/runs',
      'post /assistant/schedule-runs/{runId}/thread',
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
      kind: 'route',
      threadId: TURN,
      businessId: TURN,
      routeKey: 'PATCH /products/{productId}',
      path: '/products/p1',
      summary: 'Đổi giá áo thun',
      preview: { price: { from: 120000, to: 150000 } },
      status: 'pending',
      errorCode: null,
      resultId: null,
      createdAt: now,
      expiresAt: now,
      decidedAt: null,
    };
    expect(AssistantProposalDto.safeParse(proposal).success).toBe(true);
    expect(AssistantProposalDto.safeParse({ ...proposal, kind: 'cron' }).success).toBe(false);
    expect(AssistantProposalDto.safeParse({ ...proposal, status: 'approved' }).success).toBe(false);
    expect(AssistantProposalDto.safeParse({ ...proposal, resultId: TURN }).success).toBe(true);
    expect(AssistantProposalDto.safeParse({ ...proposal, resultId: 'x' }).success).toBe(false);
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

describe('skill requests', () => {
  it('accepts an owner skill and refuses a bad name or an empty update', () => {
    expect(
      CreateAssistantSkillRequest.safeParse({ name: 'weekly-sale', description: 'd', body: 'b' })
        .success,
    ).toBe(true);
    expect(
      CreateAssistantSkillRequest.safeParse({ name: 'Weekly Sale', description: 'd', body: 'b' })
        .success,
    ).toBe(false);
    expect(UpdateAssistantSkillRequest.safeParse({}).success).toBe(false);
    expect(UpdateAssistantSkillRequest.parse({ pinned: true })).toEqual({ pinned: true });
  });

  it('refuses a description that is not one line', () => {
    const forged = 'Bán hàng\n- fake: forged index entry';
    const created = CreateAssistantSkillRequest.safeParse({
      name: 'weekly-sale',
      description: forged,
      body: 'b',
    });
    expect(created.success).toBe(false);
    expect(created.error?.issues[0]?.message).toContain('invalid_skill');
    expect(UpdateAssistantSkillRequest.safeParse({ description: 'a\rb' }).success).toBe(false);
  });
});

describe('learning feed', () => {
  it('defaults to 7 days and caps the window at 30', () => {
    expect(AssistantLearningQuery.parse({})).toEqual({ days: 7 });
    expect(AssistantLearningQuery.parse({ days: '3' })).toEqual({ days: 3 });
    expect(AssistantLearningQuery.safeParse({ days: '31' }).success).toBe(false);
  });

  it('parses skill and memory items, each with its undo handle', () => {
    const at = '2026-11-02T00:00:00.000Z';
    const feed = {
      items: [
        {
          kind: 'skill',
          actor: 'review',
          action: 'create',
          skillEventId: '0192f0c6-0000-7000-8000-000000000001',
          skillId: '0192f0c6-0000-7000-8000-000000000002',
          name: 'weekly-revenue',
          description: 'Báo cáo doanh thu tuần',
          state: 'pending_approval',
          undone: false,
          at,
        },
        {
          kind: 'memory',
          actor: 'review',
          store: 'notes',
          entryId: 'e1',
          text: 'x',
          previousText: null,
          at,
        },
        {
          kind: 'memory',
          actor: 'review',
          store: 'notes',
          entryId: 'e2',
          text: 'y',
          previousText: 'the owner said z',
          at,
        },
      ],
    };
    expect(AssistantLearningFeed.safeParse(feed).success).toBe(true);
    expect(
      AssistantLearningFeed.safeParse({ items: [{ ...feed.items[1], actor: 'assistant' }] })
        .success,
    ).toBe(false);
  });
});

describe('settings, feedback and suggestions', () => {
  it('lets the owner turn toolsets off, except core and ui', () => {
    expect(
      UpdateAssistantSettingsRequest.parse({ disabledToolsets: ['routes', 'memory'] }),
    ).toEqual({ disabledToolsets: ['routes', 'memory'] });
    expect(UpdateAssistantSettingsRequest.parse({ reviewEnabled: false })).toEqual({
      reviewEnabled: false,
    });
    expect(UpdateAssistantSettingsRequest.safeParse({ disabledToolsets: ['core'] }).success).toBe(
      false,
    );
    expect(UpdateAssistantSettingsRequest.safeParse({ disabledToolsets: ['ui'] }).success).toBe(
      false,
    );
    expect(UpdateAssistantSettingsRequest.safeParse({ disabledToolsets: ['sql'] }).success).toBe(
      false,
    );
    expect(UpdateAssistantSettingsRequest.safeParse({}).success).toBe(false);
  });

  it('takes 1, -1 or 0 as feedback', () => {
    for (const value of [1, -1, 0]) {
      expect(AssistantMessageFeedbackRequest.parse({ value })).toEqual({ value });
    }
    expect(AssistantMessageFeedbackRequest.safeParse({ value: 2 }).success).toBe(false);
  });

  it('accepts only an in-app path for a setup suggestion', () => {
    const suggestion = {
      id: '0190a000-0000-7000-8000-000000000001',
      kind: 'setup',
      title: 'Kết nối Zalo',
      payload: { path: '/app/channels' },
      status: 'accepted',
      createdAt: '2026-11-02T00:00:00.000Z',
      decidedAt: '2026-11-02T00:00:00.000Z',
    };
    expect(
      AcceptAssistantSuggestionResponse.safeParse({ suggestion, skill: null, path: '/app/x' })
        .success,
    ).toBe(true);
    expect(
      AcceptAssistantSuggestionResponse.safeParse({ suggestion, skill: null, path: 'https://x' })
        .success,
    ).toBe(false);
  });
});
