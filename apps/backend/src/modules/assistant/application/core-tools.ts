import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import { AssistantUiAction, type AssistantPageContext } from '@agent-sales/contracts';
import { z } from 'zod';

import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository } from '../domain/ports/assistant.repository.js';

/** What the core tools work on during one turn; `uiActions` collects what the web app will do. */
export interface ToolContext {
  scope: OwnerScope;
  repo: AssistantRepository;
  uiActions: AssistantUiAction[];
  page?: AssistantPageContext;
}

export const SESSION_SEARCH_TOOL = 'session_search';
export const UI_NAVIGATE_TOOL = 'ui_navigate';
export const UI_SPOTLIGHT_TOOL = 'ui_spotlight';
export const UI_FILL_FORM_TOOL = 'ui_fill_form';
/** The longest text value `ui_fill_form` puts into one field. */
export const MAX_FILL_VALUE_CHARS = 4_000;
/** What the model is told after a fill: nothing is saved until the owner saves it. */
export const FILL_FORM_DRAFT_MESSAGE =
  'filled as a draft; the owner reviews and saves it themselves';
/** A tool result the model sees is never longer than this. */
export const MAX_CORE_RESULT_CHARS = 8_000;
const MAX_HIT_TITLE_CHARS = 120;

const SessionSearchInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(10).default(3),
});
const UiNavigateInput = z.object({ to: z.string().max(200) });
const UiSpotlightInput = z.object({ target: z.string().max(60), hint: z.string().max(200) });
const UiFillFormInput = z.object({
  formId: z.string().max(60),
  values: z.record(z.string().max(60), z.union([z.string(), z.number()])),
});

export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: SESSION_SEARCH_TOOL,
    description:
      'Search the owner’s earlier conversations with you (accent-insensitive). Use it when the owner refers to something said before.',
    input: SessionSearchInput,
  },
  {
    name: UI_NAVIGATE_TOOL,
    description:
      'Open a dashboard page for the owner. `to` is a path from the dashboard map, starting with /app.',
    input: UiNavigateInput,
  },
  {
    name: UI_SPOTLIGHT_TOOL,
    description:
      'Highlight a control on the current page with a short hint. `target` must be one of the targets listed in <page_context>.',
    input: UiSpotlightInput,
  },
  {
    name: UI_FILL_FORM_TOOL,
    description:
      'Fill fields of a form on the current page as a draft. `formId` and every key of `values` must come from the forms listed in <page_context>; a select field takes one of its options. It never saves or submits: tell the owner to review the form and save it themselves.',
    input: UiFillFormInput,
  },
];

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

const MAX_DECODE_PASSES = 3;

/**
 * An in-app path only (ruling R6), the same rule as the web app's `safeAppPath`: decoded until
 * stable (at most 3 passes, so `%252e%252e` cannot hide a dot segment; a bad escape is refused),
 * then no `%`, query, hash, backslash, `//` or control character may remain, no `.` or `..`
 * segment, and it must be `/app` or `/app/…`. A navigation can never leave the dashboard.
 */
export function isAppPath(to: string): boolean {
  let decoded = to;
  try {
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return false;
  }
  if (/[%?#\\]/.test(decoded) || decoded.includes('//')) return false;
  if ([...decoded].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return false;
  if (!/^\/app(\/|$)/.test(decoded)) return false;
  return !decoded.split('/').some((seg) => seg === '..' || seg === '.');
}

/** session_search, ui_navigate, ui_spotlight and ui_fill_form for one turn. */
export function coreTools(ctx: ToolContext): RunnableTool[] {
  const sessionSearch: RunnableTool = {
    name: SESSION_SEARCH_TOOL,
    readOnly: true,
    schema: SessionSearchInput,
    async run(input) {
      const { query, limit } = input as z.output<typeof SessionSearchInput>;
      const hits = (await ctx.repo.searchMessages(ctx.scope, query, limit)).map((h) => ({
        threadTitle: h.threadTitle.slice(0, MAX_HIT_TITLE_CHARS),
        role: h.role,
        snippet: h.snippet,
        at: h.createdAt.toISOString(),
      }));
      let content = json({ hits });
      while (content.length > MAX_CORE_RESULT_CHARS && hits.length > 0) {
        hits.pop();
        content = json({ hits });
      }
      return { content };
    },
  };

  const navigate: RunnableTool = {
    name: UI_NAVIGATE_TOOL,
    readOnly: false,
    schema: UiNavigateInput,
    run(input) {
      const { to } = input as z.output<typeof UiNavigateInput>;
      const action = AssistantUiAction.safeParse({ type: 'navigate', to });
      if (!isAppPath(to) || !action.success) {
        return Promise.resolve({
          content: json({ ok: false, errorCode: 'invalid_path' }),
          ok: false,
        });
      }
      ctx.uiActions.push(action.data);
      return Promise.resolve({ content: json({ ok: true }) });
    },
  };

  const spotlight: RunnableTool = {
    name: UI_SPOTLIGHT_TOOL,
    readOnly: false,
    schema: UiSpotlightInput,
    run(input) {
      const { target, hint } = input as z.output<typeof UiSpotlightInput>;
      const action = AssistantUiAction.safeParse({ type: 'spotlight', target, hint });
      if (!ctx.page?.targets?.includes(target) || !action.success) {
        return Promise.resolve({
          content: json({ ok: false, errorCode: 'unknown_target' }),
          ok: false,
        });
      }
      ctx.uiActions.push(action.data);
      return Promise.resolve({ content: json({ ok: true }) });
    },
  };

  const fillForm: RunnableTool = {
    name: UI_FILL_FORM_TOOL,
    readOnly: false,
    schema: UiFillFormInput,
    run(input) {
      const { formId, values } = input as z.output<typeof UiFillFormInput>;
      const fail = (errorCode: string) =>
        Promise.resolve({ content: json({ ok: false, errorCode }), ok: false });
      const form = ctx.page?.forms?.find((f) => f.id === formId);
      if (!form) return fail('unknown_form');
      const names = Object.keys(values);
      if (names.length === 0) return fail('no_values');
      for (const name of names) {
        const field = form.fields.find((f) => f.name === name);
        if (!field) return fail(`unknown_field:${name}`);
        const value = values[name] as string | number;
        if (typeof value === 'string' && value.length > MAX_FILL_VALUE_CHARS) {
          return fail(`too_long:${name}`);
        }
        if (field.type === 'select' && !(field.options ?? []).includes(String(value))) {
          return fail(`invalid_option:${name}`);
        }
      }
      const action = AssistantUiAction.safeParse({ type: 'fill_form', formId, values });
      if (!action.success) return fail('invalid_values');
      ctx.uiActions.push(action.data);
      return Promise.resolve({ content: json({ ok: true, message: FILL_FORM_DRAFT_MESSAGE }) });
    },
  };

  return [sessionSearch, navigate, spotlight, fillForm];
}
