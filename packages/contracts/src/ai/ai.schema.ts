import { z } from 'zod';

export const PlaygroundMessage = z.object({
  role: z.enum(['customer', 'bot']),
  content: z.string().trim().min(1).max(2000),
});
export type PlaygroundMessage = z.infer<typeof PlaygroundMessage>;

/** A customer image attached to the last customer message (Hermes provider only; max 3 x 3 MB). */
export const PlaygroundImage = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z
    .string()
    .min(8)
    .max(4_000_008)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type PlaygroundImage = z.infer<typeof PlaygroundImage>;

/** The test conversation so far; the last message is the customer's turn to answer. */
export const PlaygroundRequest = z.object({
  messages: z
    .array(PlaygroundMessage)
    .min(1)
    .max(20)
    .refine((m) => m.at(-1)?.role === 'customer', {
      message: 'the last message must come from the customer',
    }),
  images: z.array(PlaygroundImage).max(3).optional(),
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

/** A stored picture the bot sends after its text (an allowlisted https URL, never model text). */
export const BotReplyImage = z.object({ url: z.url().max(2000), label: z.string() });
export type BotReplyImage = z.infer<typeof BotReplyImage>;

export const PlaygroundResponse = z.object({
  runId: z.uuid(),
  reply: z.string(),
  outcome: AiOutcome,
  /** Why a reply was replaced, e.g. a number that is not in the sources. */
  guardrail: z.string().nullable(),
  sources: z.array(PlaygroundSource),
  /** Pictures to send after the text (max 3); empty unless the customer asked to see one. */
  images: z.array(BotReplyImage).max(3).default([]),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cachedInputTokens: z.number().int(),
  }),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number().int(),
  /** API actions the bot called while answering (name only, never arguments or data). */
  actions: z
    .array(z.object({ name: z.string(), ok: z.boolean(), statusCode: z.number().int().nullable() }))
    .optional(),
});
export type PlaygroundResponse = z.infer<typeof PlaygroundResponse>;
