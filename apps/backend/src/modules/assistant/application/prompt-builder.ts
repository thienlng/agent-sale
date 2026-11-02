import {
  PROMPTS_DIR,
  PromptRegistry,
  scanUntrustedText,
  type PromptRef,
} from '@agent-sales/ai-core';
import { AssistantPageContext } from '@agent-sales/contracts';

import { compareStores, memoryLimit, memoryUsed } from '../domain/memory-store.js';
import type { MemoryStoreRecord } from '../domain/ports/assistant.repository.js';

/**
 * The pinned assistant prompt for new threads (`packages/ai-core/prompts/assistant@2.md`).
 * `assistant@1.md` stays for threads created before it: a thread's prompt is frozen.
 */
export const ASSISTANT_PROMPT = { name: 'assistant', version: 2 } as const satisfies PromptRef;

/** What the stable system prompt says about the account; nothing that changes per turn. */
export interface AccountSnapshot {
  ownerName: string;
  businesses: { name: string; industry: string }[];
}

const registry = new PromptRegistry(PROMPTS_DIR);
const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const PAGE_KEYS = Object.keys(AssistantPageContext.shape) as (keyof AssistantPageContext)[];

/** The frozen tier of the prompt: the skills index and the memory snapshot. */
export interface PromptExtras {
  /** `renderSkillIndex` output. */
  skillsIndex: string;
  memory: MemoryStoreRecord[];
}

/**
 * The memory snapshot: each non-empty store as `<store> [<pct>% — <used>/<limit>]` and its
 * entries as `- <text>` lines, in the order owner_profile, notes, business stores by id. Entries
 * that fail the safety scan now are left out (the store's usage still counts them). Empty text
 * when nothing is remembered. Pure and byte-stable.
 */
export function renderMemoryBlock(memory: readonly MemoryStoreRecord[]): string {
  return [...memory]
    .sort((a, b) => compareStores(a.store, b.store))
    .flatMap((m) => {
      const lines = m.entries
        .filter((e) => scanUntrustedText(e.text).ok)
        .map((e) => `- ${e.text.replace(/\s*\n\s*/g, ' ')}`);
      if (lines.length === 0) return [];
      const limit = memoryLimit(m.store);
      const used = memoryUsed(m.entries);
      const pct = Math.round((used / limit) * 100);
      return [[`${m.store} [${pct}% — ${used}/${limit}]`, ...lines].join('\n')];
    })
    .join('\n\n');
}

/**
 * The thread's system prompt, frozen when the thread starts so the provider prompt cache stays
 * warm: same inputs give a byte-identical string. Businesses render as `- <name> (<industry>)`
 * lines; `today` is the Asia/Ho_Chi_Minh calendar date (YYYY-MM-DD); the skills index and the
 * memory snapshot fill the template's `{{skills.index}}` and `{{memory.block}}` when it has them.
 */
export function buildSystemPrompt(
  template: string,
  snap: AccountSnapshot,
  today: Date,
  extras: PromptExtras,
): string {
  return registry.render(template, {
    'owner.name': snap.ownerName,
    'account.businesses': snap.businesses.map((b) => `- ${b.name} (${b.industry})`).join('\n'),
    today: DAY.format(today),
    'skills.index': extras.skillsIndex,
    'memory.block': renderMemoryBlock(extras.memory),
  });
}

/** Loads the pinned template text (cached by the registry). */
export function loadAssistantTemplate(): Promise<string> {
  return registry.load(ASSISTANT_PROMPT);
}

/**
 * What the model sees as the owner's latest message: the page they are on (JSON, keys in the
 * schema's order), the local time (Asia/Ho_Chi_Minh, HH:mm), then their text. Only the last
 * user message gets this; history keeps the raw text, so earlier turns stay cache-stable. Pure.
 */
export function buildTurnMessage(
  text: string,
  page: AssistantPageContext | undefined,
  now: Date,
): string {
  const lines: string[] = [];
  if (page) {
    const ordered: Record<string, unknown> = {};
    for (const key of PAGE_KEYS) if (page[key] !== undefined) ordered[key] = page[key];
    // `<` is escaped so page text cannot close the tag.
    const json = JSON.stringify(ordered).replaceAll('<', '\\u003c');
    lines.push(`<page_context>${json}</page_context>`);
  }
  lines.push(`<current_time>${CLOCK.format(now)}</current_time>`, text);
  return lines.join('\n');
}
