import { z } from 'zod';

import { CARE_MESSAGE_MAX_CHARS, type MessageTemplate } from './care.js';

/** Versioned system prompt in `packages/ai-core/prompts/` (Rule 05). */
export const CARE_WRITER_PROMPT = { name: 'care-follow-up', version: 1 } as const;
export const CARE_WRITER_TIER = 'basic' as const;
export const CARE_WRITER_MAX_OUTPUT_TOKENS = 600;
export const CARE_WRITER_TIMEOUT_MS = 20_000;
/** The writer reads the last messages only (spec §4). */
export const CARE_WRITER_MESSAGES = 20;

/** The structured answer: a message to send, or `skip` with a reason. */
export const CareWriterWireSchema = z.object({
  action: z.enum(['send', 'skip']),
  text: z.string(),
  reason: z.string(),
});

export type WriterOutput = { kind: 'send'; text: string } | { kind: 'skip'; reason: string };

/**
 * Reads the model's answer: a message of at most 600 characters, or a skip. A message that is
 * empty or longer than 600 characters is a skip (spec §4: "≤ 600 chars or skip"). Null when the
 * answer is not the JSON asked for.
 */
export function parseWriterOutput(raw: string): WriterOutput | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = CareWriterWireSchema.safeParse(json);
  if (!parsed.success) return null;
  const { action, text, reason } = parsed.data;
  if (action === 'skip') return { kind: 'skip', reason: reason.trim().slice(0, 200) || 'skip' };
  const clean = text.trim();
  if (!clean) return { kind: 'skip', reason: 'empty' };
  if (clean.length > CARE_MESSAGE_MAX_CHARS) return { kind: 'skip', reason: 'too_long' };
  return { kind: 'send', text: clean };
}

/** The goal of each step, in the model's words (English; the message itself is Vietnamese). */
export const STEP_GOALS: Readonly<Record<MessageTemplate, readonly string[]>> = {
  silent: [
    'The customer went quiet about 2 hours ago after our answer. Answer their open question if any and add ONE useful detail that helps them decide. No pressure.',
    'Last chance before the shop can no longer message them: a short, friendly check whether they still need help, with the one detail that matters most.',
  ],
  ready: [
    'The customer looked ready to buy or book about an hour ago but has not ordered. Recap what they chose and say clearly how to order or book (the next step). Short.',
  ],
};

/** The persona the shop set on its bot (no free text). */
export interface WriterPersona {
  selfPronoun: string;
  customerPronoun: string;
  tone: 'friendly' | 'formal';
  allowEmoji: boolean;
  language: 'vi' | 'en';
}

const SENDER_LABEL = { customer: 'Customer', human: 'Staff', bot: 'Bot' } as const;
const HCM_OFFSET_MS = 7 * 3_600_000;
const localTime = (iso: string) =>
  new Date(Date.parse(iso) + HCM_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

/** One line inside a data fence: whitespace collapsed, fence marks broken up. */
export function fenceSafe(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/<{3,}/g, (m) => m.split('').join(' '))
    .replace(/>{3,}/g, (m) => m.split('').join(' '));
}

function personaLine(p: WriterPersona | null): string {
  if (!p) return '(not set: polite, friendly, short)';
  return [
    `self=${p.selfPronoun || 'em'}`,
    `customer=${p.customerPronoun || 'anh/chị'}`,
    `tone=${p.tone}`,
    `emoji=${p.allowEmoji ? 'allowed' : 'none'}`,
    `language=${p.language}`,
  ].join('; ');
}

/**
 * The user message of one follow-up (spec §4): the goal of the step, the owner's instruction, the
 * bot's persona and facts, the Brain's note and the last 20 messages. Everything the shop or the
 * customer wrote is fenced as data.
 */
export function buildWriterInput(input: {
  template: MessageTemplate;
  step: number;
  instruction: string;
  persona: WriterPersona | null;
  facts: readonly { label: string; value: string }[];
  note: string | null;
  messages: readonly { sender: 'customer' | 'human' | 'bot'; text: string; at: string }[];
}): string {
  const goal = STEP_GOALS[input.template][input.step] ?? STEP_GOALS[input.template][0] ?? '';
  const facts = input.facts
    .slice(0, 30)
    .map((f) => `${fenceSafe(f.label).slice(0, 60)}: ${fenceSafe(f.value).slice(0, 300)}`);
  const lines = input.messages.map(
    (m) => `[${localTime(m.at)}] ${SENDER_LABEL[m.sender]}: ${fenceSafe(m.text)}`,
  );
  return [
    `GOAL: ${goal}`,
    `OWNER INSTRUCTION:\n<<<\n${fenceSafe(input.instruction) || '(none)'}\n>>>`,
    `PERSONA: ${personaLine(input.persona)}`,
    `SHOP FACTS:\n<<<\n${facts.join('\n') || '(none)'}\n>>>`,
    // The Brain's note summarises customer text: data, fenced like the messages.
    `NOTE:\n<<<\n${input.note ? fenceSafe(input.note) : '(none)'}\n>>>`,
    `MESSAGES (oldest first):\n<<<\n${lines.join('\n')}\n>>>`,
  ].join('\n\n');
}
