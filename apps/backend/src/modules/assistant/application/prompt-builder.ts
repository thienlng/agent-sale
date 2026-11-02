import { PROMPTS_DIR, PromptRegistry, type PromptRef } from '@agent-sales/ai-core';
import { AssistantPageContext } from '@agent-sales/contracts';

/** The pinned assistant prompt (`packages/ai-core/prompts/assistant@1.md`). */
export const ASSISTANT_PROMPT = { name: 'assistant', version: 1 } as const satisfies PromptRef;

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

/**
 * The thread's system prompt, frozen when the thread starts so the provider prompt cache stays
 * warm: same inputs give a byte-identical string. Businesses render as `- <name> (<industry>)`
 * lines; `today` is the Asia/Ho_Chi_Minh calendar date (YYYY-MM-DD).
 */
export function buildSystemPrompt(template: string, snap: AccountSnapshot, today: Date): string {
  return registry.render(template, {
    'owner.name': snap.ownerName,
    'account.businesses': snap.businesses.map((b) => `- ${b.name} (${b.industry})`).join('\n'),
    today: DAY.format(today),
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
