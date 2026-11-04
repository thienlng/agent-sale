import type { AssistantPageContext, AssistantUiAction } from '@agent-sales/contracts';
import type { RunnableTool } from '@agent-sales/ai-core';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import {
  CORE_TOOL_DEFINITIONS,
  coreTools,
  FILL_FORM_DRAFT_MESSAGE,
  MAX_FILL_VALUE_CHARS,
} from '../application/core-tools.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const BUSINESS = workspaceId(newId());

const scope: OwnerScope = {
  accountId: newId(),
  ownerUserId: userId(newId()),
  businessId: BUSINESS,
  businessIds: [BUSINESS],
};

function setup(page?: AssistantPageContext) {
  const repo = new InMemoryAssistantRepository();
  const uiActions: AssistantUiAction[] = [];
  const tools = coreTools({ scope, repo, uiActions, ...(page ? { page } : {}) });
  const tool = (name: string): RunnableTool => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  /** Validates like the agent loop does, then runs. */
  const run = async (name: string, input: unknown) => {
    const t = tool(name);
    const out = await t.run(t.schema.parse(input));
    return { ...out, json: JSON.parse(out.content) as Record<string, unknown> };
  };
  /** The agent loop would refuse these arguments before running the tool. */
  const invalid = (name: string, input: unknown) => !tool(name).schema.safeParse(input).success;
  return { repo, uiActions, tools, run, invalid };
}

describe('coreTools', () => {
  it('offers session_search and the UI tools, with a definition for each', () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual([
      'session_search',
      'ui_navigate',
      'ui_spotlight',
      'ui_fill_form',
    ]);
    expect(CORE_TOOL_DEFINITIONS.map((d) => d.name)).toEqual(tools.map((t) => t.name));
    expect(tools.find((t) => t.name === 'session_search')?.readOnly).toBe(true);
  });

  it('navigates inside the app and records the action', async () => {
    const { run, uiActions } = setup();
    expect((await run('ui_navigate', { to: '/app/products' })).json).toEqual({ ok: true });
    expect(uiActions).toEqual([{ type: 'navigate', to: '/app/products' }]);
  });

  it.each(['/app', '/app/products', '/app/bots/abc', '/app/%70roducts'])(
    'navigates to the in-app path %s',
    async (to) => {
      const { run, uiActions } = setup();
      expect((await run('ui_navigate', { to })).json).toEqual({ ok: true });
      expect(uiActions).toEqual([{ type: 'navigate', to }]);
    },
  );

  it.each([
    'https://x',
    '/application',
    '/app/../admin',
    '/apps',
    '//evil.test/app',
    // The same rule as the web app's safeAppPath (decoded until stable, then checked).
    '/apple',
    '/app/../x',
    '/app/%2e%2e/x',
    '/app/%2E%2E/x',
    '/app/%252e%252e/login',
    '/app/%25252e%25252e/login',
    '/app/%2525252e%2525252e/login',
    '/app/%2f%2e%2e/login',
    '/app//evil.test',
    '/app?x=1',
    '/app/orders#x',
    '/app/products%3Fx=1',
    '/app/%E0%A4%A',
    '/app\\..\\login',
    '/app/%5c..%5clogin',
    '/app/\u0000x',
    '/app/./products',
  ])('refuses to navigate to %s', async (to) => {
    const { run, uiActions } = setup();
    const out = await run('ui_navigate', { to });
    expect(out).toMatchObject({ ok: false, json: { ok: false, errorCode: 'invalid_path' } });
    expect(uiActions).toEqual([]);
  });

  it('spotlights only a target listed in the page context', async () => {
    const { run, uiActions } = setup({ route: '/app/products', targets: ['products.import'] });
    const unknown = await run('ui_spotlight', { target: 'bot.save', hint: 'Bấm Lưu' });
    expect(unknown).toMatchObject({ ok: false, json: { ok: false, errorCode: 'unknown_target' } });
    expect(
      (await run('ui_spotlight', { target: 'products.import', hint: 'Nhập từ Excel' })).json,
    ).toEqual({ ok: true });
    expect(uiActions).toEqual([
      { type: 'spotlight', target: 'products.import', hint: 'Nhập từ Excel' },
    ]);
  });

  it('refuses a spotlight when there is no page context', async () => {
    const { run } = setup();
    expect((await run('ui_spotlight', { target: 'x', hint: 'y' })).json).toEqual({
      ok: false,
      errorCode: 'unknown_target',
    });
  });

  it('finds earlier messages without accents', async () => {
    const { repo, run, invalid } = setup();
    const t = await repo.createThread(scope, {
      id: newId(),
      title: 'Ảnh sản phẩm',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    const row = {
      toolCalls: null,
      toolCallId: null,
      toolName: null,
      pageContext: null,
      uiActions: [],
      runId: null,
    };
    await repo.appendMessages(scope, t.id, [
      { ...row, id: newId(), role: 'user', content: 'Sản phẩm nào chưa có ảnh?' },
      { ...row, id: newId(), role: 'assistant', content: 'Dạ có 3 sản phẩm ạ' },
    ]);
    const out = await run('session_search', { query: 'chua co anh' });
    expect(out.json).toEqual({
      hits: [
        {
          threadTitle: 'Ảnh sản phẩm',
          role: 'user',
          snippet: 'Sản phẩm nào chưa có ảnh?',
          at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      ],
    });
    expect((await run('session_search', { query: 'san pham' })).json.hits).toHaveLength(2);
    expect((await run('session_search', { query: 'san pham', limit: 1 })).json.hits).toHaveLength(
      1,
    );
    expect(invalid('session_search', { query: '  ' })).toBe(true);
    expect(invalid('session_search', { query: 'x', limit: 11 })).toBe(true);
  });

  it('keeps every result within 8 000 characters', async () => {
    const { repo, run } = setup();
    const t = await repo.createThread(scope, {
      id: newId(),
      title: 'x'.repeat(5_000),
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    await repo.appendMessages(
      scope,
      t.id,
      Array.from({ length: 10 }, () => ({
        id: newId(),
        role: 'user' as const,
        content: 'giá áo',
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: null,
      })),
    );
    const out = await run('session_search', { query: 'gia ao', limit: 10 });
    expect(out.content.length).toBeLessThanOrEqual(8_000);
    expect(Array.isArray(out.json.hits)).toBe(true);
  });

  describe('ui_fill_form', () => {
    const FORM_PAGE: AssistantPageContext = {
      route: '/app/products/new',
      forms: [
        {
          id: 'product.form',
          fields: [
            { name: 'name', label: 'Tên', type: 'text', empty: true },
            { name: 'price', label: 'Giá', type: 'number', empty: true },
            { name: 'notes', label: 'Ghi chú', type: 'textarea', empty: true },
            {
              name: 'status',
              label: 'Trạng thái',
              type: 'select',
              options: ['draft', 'active'],
              empty: false,
            },
          ],
        },
      ],
    };

    it('fills declared fields as a draft and records the action', async () => {
      const { run, uiActions } = setup(FORM_PAGE);
      const values = { name: 'Áo thun', price: 120_000, status: 'active' };
      const out = await run('ui_fill_form', { formId: 'product.form', values });
      expect(out.json).toEqual({ ok: true, message: FILL_FORM_DRAFT_MESSAGE });
      expect(FILL_FORM_DRAFT_MESSAGE).toBe(
        'filled as a draft; the owner reviews and saves it themselves',
      );
      expect(uiActions).toEqual([{ type: 'fill_form', formId: 'product.form', values }]);
    });

    it.each([
      ['an unknown form', { formId: 'other.form', values: { name: 'x' } }, 'unknown_form'],
      [
        'an undeclared field',
        { formId: 'product.form', values: { sku: 'x' } },
        'unknown_field:sku',
      ],
      [
        'a select value outside its options',
        { formId: 'product.form', values: { status: 'deleted' } },
        'invalid_option:status',
      ],
      [
        'a text longer than 4 000 chars',
        { formId: 'product.form', values: { notes: 'x'.repeat(MAX_FILL_VALUE_CHARS + 1) } },
        'too_long:notes',
      ],
      ['no values', { formId: 'product.form', values: {} }, 'no_values'],
    ])('refuses %s', async (_what, input, errorCode) => {
      const { run, uiActions } = setup(FORM_PAGE);
      const out = await run('ui_fill_form', input);
      expect(out).toMatchObject({ ok: false, json: { ok: false, errorCode } });
      expect(uiActions).toEqual([]);
    });

    it('refuses values the ui action schema rejects (invalid_values), as a last check', async () => {
      // The loop's input schema already refuses these; the tool re-checks the ui action itself.
      const { tools, uiActions } = setup(FORM_PAGE);
      const fill = tools.find((t) => t.name === 'ui_fill_form')!;
      const out = await fill.run({
        formId: 'product.form',
        values: { price: Number.POSITIVE_INFINITY },
      });
      expect(out.ok).toBe(false);
      expect(JSON.parse(out.content)).toEqual({ ok: false, errorCode: 'invalid_values' });
      expect(uiActions).toEqual([]);
    });

    it('accepts a text of exactly 4 000 chars, and refuses every form when the page has none', async () => {
      const page = setup(FORM_PAGE);
      const notes = 'x'.repeat(MAX_FILL_VALUE_CHARS);
      expect(
        (await page.run('ui_fill_form', { formId: 'product.form', values: { notes } })).json,
      ).toMatchObject({ ok: true });
      const bare = setup({ route: '/app' });
      expect(
        (await bare.run('ui_fill_form', { formId: 'product.form', values: { name: 'x' } })).json,
      ).toEqual({ ok: false, errorCode: 'unknown_form' });
      expect(
        (await setup().run('ui_fill_form', { formId: 'product.form', values: { name: 'x' } })).json,
      ).toEqual({ ok: false, errorCode: 'unknown_form' });
    });
  });
});
