import { fenceSafe } from './evaluation-prompt.js';

/** Versioned system prompt in `packages/ai-core/prompts/` (Rule 05). */
export const REPLY_DRAFT_PROMPT = { name: 'brain-reply-draft', version: 1 } as const;
export const REPLY_DRAFT_TIER = 'basic' as const;
export const REPLY_DRAFT_MAX_OUTPUT_TOKENS = 600;
export const REPLY_DRAFT_TIMEOUT_MS = 20_000;
/** The draft reads the last messages only (spec §5). */
export const REPLY_DRAFT_MESSAGES = 20;
/** A message sent from the inbox is at most this long. */
export const REPLY_DRAFT_MAX_CHARS = 2000;

/** What the draft needs of the bot's persona (`BotView`). */
export interface DraftPersona {
  name: string;
  selfPronoun: string;
  customerPronoun: string;
  tone: 'friendly' | 'formal';
  allowEmoji: boolean;
  replyLength: 'veryShort' | 'short' | 'detailed';
  language: 'vi' | 'en';
}

const SENDER_LABEL = { customer: 'Customer', human: 'Staff', bot: 'Bot' } as const;
const HCM_OFFSET_MS = 7 * 3_600_000;
const localTime = (iso: string) =>
  new Date(Date.parse(iso) + HCM_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

/** The persona line: how the shop talks, without any instruction text the shop wrote. */
export function personaLine(p: DraftPersona | null): string {
  if (!p) return '(not set: polite, friendly, short)';
  return [
    `self=${p.selfPronoun || 'em'}`,
    `customer=${p.customerPronoun || 'anh/chị'}`,
    `tone=${p.tone}`,
    `length=${p.replyLength}`,
    `emoji=${p.allowEmoji ? 'allowed' : 'none'}`,
    `language=${p.language}`,
  ].join('; ');
}

/** The user message of a reply draft: persona, the signals' note and the fenced messages. */
export function buildReplyDraftInput(input: {
  note: string | null;
  messages: readonly { sender: 'customer' | 'human' | 'bot'; text: string; at: string }[];
  bot: DraftPersona | null;
}): string {
  const lines = input.messages.map(
    (m) => `[${localTime(m.at)}] ${SENDER_LABEL[m.sender]}: ${fenceSafe(m.text)}`,
  );
  return [
    `PERSONA: ${personaLine(input.bot)}`,
    `NOTE:\n${input.note ?? '(none)'}`,
    `MESSAGES (oldest first):\n<<<\n${lines.join('\n')}\n>>>`,
  ].join('\n\n');
}
