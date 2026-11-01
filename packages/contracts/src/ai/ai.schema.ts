import { FanpageContext } from '../channel/fanpage.schema.js';
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

/**
 * How many turns of history a reply sees (channel conversations and the playground). Long
 * histories are compressed by the ai module before the model call.
 */
export const REPLY_HISTORY_MAX_TURNS = 100;

/** The test conversation so far; the last message is the customer's turn to answer. */
export const PlaygroundRequest = z.object({
  messages: z
    .array(PlaygroundMessage)
    .min(1)
    .max(REPLY_HISTORY_MAX_TURNS)
    .refine((m) => m.at(-1)?.role === 'customer', {
      message: 'the last message must come from the customer',
    }),
  images: z.array(PlaygroundImage).max(3).optional(),
  postContext: FanpageContext.optional(),
  /** The customer already left a phone number: the bot must not ask for it again. */
  phoneKnown: z.boolean().optional(),
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
  /** Every picture the bot sent this turn, in order (per message: see `messages`). */
  images: z.array(BotReplyImage).max(30).default([]),
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
  /** Each message the bot sent, in order (`reply` and `images` stay as the joined view). */
  messages: z
    .array(
      z.object({
        text: z.string(),
        images: z.array(z.object({ id: z.string(), url: z.string(), label: z.string() })),
        via: z.enum(['send_message', 'final']),
        /** Buttons under this message (the order summary's confirm/edit). */
        quickReplies: z
          .array(z.object({ title: z.string().max(20), payload: z.string().max(100) }))
          .max(3)
          .optional(),
      }),
    )
    .optional(),
  /** What the bot did while answering (kinds and names only). */
  steps: z
    .array(
      z.object({
        kind: z.string(),
        name: z.string().optional(),
        ok: z.boolean().optional(),
        ms: z.number().optional(),
      }),
    )
    .optional(),
  /** True when a newer customer message cut this turn short. */
  interrupted: z.boolean().optional(),
});
export type PlaygroundResponse = z.infer<typeof PlaygroundResponse>;
