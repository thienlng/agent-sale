import { PROMPTS_DIR, PromptRegistry, type PromptRef } from '@agent-sales/ai-core';

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
