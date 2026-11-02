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
/** A tool result the model sees is never longer than this. */
export const MAX_CORE_RESULT_CHARS = 8_000;
const MAX_HIT_TITLE_CHARS = 120;

const SessionSearchInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(10).default(3),
});
const UiNavigateInput = z.object({ to: z.string().max(200) });
const UiSpotlightInput = z.object({ target: z.string().max(60), hint: z.string().max(200) });

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
];

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

/**
 * An in-app path only (ruling R6): `/app` or `/app/…`, no `..` segment and no backslash, so a
 * navigation can never leave the dashboard.
 */
export function isAppPath(to: string): boolean {
  if (!/^\/app(\/|$|\?|#)/.test(to) || to.includes('\\')) return false;
  const path = to.split(/[?#]/, 1)[0] ?? '';
  return !path.split('/').some((seg) => seg === '..' || seg === '.');
}

/** session_search, ui_navigate and ui_spotlight for one turn. */
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

  return [sessionSearch, navigate, spotlight];
}
