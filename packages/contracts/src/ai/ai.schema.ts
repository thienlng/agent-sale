import { z } from 'zod';

export const PlaygroundMessage = z.object({
  role: z.enum(['customer', 'bot']),
  content: z.string().trim().min(1).max(2000),
});
export type PlaygroundMessage = z.infer<typeof PlaygroundMessage>;

/** The test conversation so far; the last message is the customer's turn to answer. */
export const PlaygroundRequest = z.object({
  messages: z
    .array(PlaygroundMessage)
    .min(1)
    .max(20)
    .refine((m) => m.at(-1)?.role === 'customer', {
      message: 'the last message must come from the customer',
    }),
});
export type PlaygroundRequest = z.infer<typeof PlaygroundRequest>;

/**
 * answered: grounded reply; fallback: the bot did not know (bot's fallback
 * message, "red tag" candidate); handoff: a human should take over.
 */
export const AiOutcome = z.enum(['answered', 'fallback', 'handoff']);
export type AiOutcome = z.infer<typeof AiOutcome>;

export const PlaygroundSource = z.object({
  faqId: z.uuid(),
  question: z.string(),
  score: z.number(),
  /** The model cited this source in its reply. */
  used: z.boolean(),
});

export const PlaygroundResponse = z.object({
  runId: z.uuid(),
  reply: z.string(),
  outcome: AiOutcome,
  /** Why a reply was replaced, e.g. a number that is not in the sources. */
  guardrail: z.string().nullable(),
  sources: z.array(PlaygroundSource),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cachedInputTokens: z.number().int(),
  }),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number().int(),
});
export type PlaygroundResponse = z.infer<typeof PlaygroundResponse>;
