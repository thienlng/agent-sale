import type { ToolDefinition } from '@agent-sales/ai-core';
import { ASSISTANT_LOCKED_TOOLSETS, type AssistantToolsetId } from '@agent-sales/contracts';

import {
  SESSION_SEARCH_TOOL,
  UI_FILL_FORM_TOOL,
  UI_NAVIGATE_TOOL,
  UI_SPOTLIGHT_TOOL,
} from './core-tools.js';
import { IMPORT_PREVIEW_TOOL, IMPORT_PROPOSE_TOOL } from './import-tools.js';
import { MEMORY_TOOL } from './memory-tools.js';
import { TOOL_CALL_TOOL, TOOL_DESCRIBE_TOOL, TOOL_SEARCH_TOOL } from './route-tools.js';
import { LOAD_SKILL_TOOL, SKILL_MANAGE_TOOL, SKILLS_LIST_TOOL } from './skill-tools.js';
import { SQL_QUERY_KEY, SQL_SCHEMA_KEY, SQL_TOOLSET } from './sql/sql-tools.js';

export interface Toolset {
  id: AssistantToolsetId;
  /** i18n key in the web's `assistant` namespace. */
  labelKey: string;
  /** The always-loaded tools of the turn's tool list. */
  tools: readonly string[];
  /**
   * Deferred native tools (found by tool_search, run by tool_call). Turning the toolset off
   * drops them from the deferred catalog; they are not in the tool list.
   */
  deferred?: readonly string[];
}

/** The chat turn's tools by toolset (spec §6). `core` and `ui` cannot be turned off. */
export const TOOLSETS: readonly Toolset[] = [
  { id: 'core', labelKey: 'toolsets.core', tools: [SESSION_SEARCH_TOOL] },
  {
    id: 'ui',
    labelKey: 'toolsets.ui',
    tools: [UI_NAVIGATE_TOOL, UI_SPOTLIGHT_TOOL, UI_FILL_FORM_TOOL],
  },
  { id: 'memory', labelKey: 'toolsets.memory', tools: [MEMORY_TOOL] },
  {
    id: 'skills',
    labelKey: 'toolsets.skills',
    tools: [SKILLS_LIST_TOOL, LOAD_SKILL_TOOL, SKILL_MANAGE_TOOL],
  },
  {
    id: 'routes',
    labelKey: 'toolsets.routes',
    tools: [TOOL_SEARCH_TOOL, TOOL_DESCRIBE_TOOL, TOOL_CALL_TOOL],
  },
  // Capability 4 (T-173): bulk product import from an attached sheet or photos.
  { id: 'import', labelKey: 'toolsets.import', tools: [IMPORT_PREVIEW_TOOL, IMPORT_PROPOSE_TOOL] },
  // Capability 2: the SQL lane's deferred tools (ChatTurnService leaves them out when off).
  {
    id: SQL_TOOLSET,
    labelKey: 'toolsets.sql',
    tools: [],
    deferred: [SQL_SCHEMA_KEY, SQL_QUERY_KEY],
  },
];

export const isLockedToolset = (id: string): boolean =>
  (ASSISTANT_LOCKED_TOOLSETS as readonly string[]).includes(id);

/** The known, switchable toolsets of a stored list, sorted and unique. */
export function normalizeDisabled(ids: readonly string[]): AssistantToolsetId[] {
  const known = new Set(TOOLSETS.map((t) => t.id as string));
  return [...new Set(ids)]
    .filter((id) => known.has(id) && !isLockedToolset(id))
    .sort() as AssistantToolsetId[];
}

/** The names of the tools a disabled toolset removes from the turn. */
export function disabledTools(disabled: readonly string[]): Set<string> {
  const off = new Set(normalizeDisabled(disabled));
  return new Set(TOOLSETS.filter((t) => off.has(t.id)).flatMap((t) => t.tools));
}

/** The definitions left once the disabled toolsets are removed (order kept: cache-stable). */
export function enabledDefinitions(
  defs: readonly ToolDefinition[],
  disabled: readonly string[],
): ToolDefinition[] {
  const off = disabledTools(disabled);
  return defs.filter((d) => !off.has(d.name));
}

/**
 * The prompt-cache key suffix of a disabled set: empty when everything is on, else `:off=` and
 * the sorted ids, so a turn with fewer tools never reuses a cache entry built with more.
 */
export function toolsetCacheSuffix(disabled: readonly string[]): string {
  const ids = normalizeDisabled(disabled);
  return ids.length > 0 ? `:off=${ids.join(',')}` : '';
}
