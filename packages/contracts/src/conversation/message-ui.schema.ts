import { z } from 'zod';

/**
 * Interactive parts of a bot message on the website channel (ADR-029): product cards and
 * suggested next steps. Built by the server from catalog data and from the links the visitor's
 * page offers, never from model-written URLs or prices. Other channels never carry them.
 */
export const MessageCard = z.object({
  productId: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  /** The price line ("350.000đ", "Từ 199.000đ", the offering's price note); empty when unknown. */
  price: z.string().max(80).default(''),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .nullable(),
});
export type MessageCard = z.infer<typeof MessageCard>;

/** `reply`: tapping sends `text` as the visitor's message. `link`: opens a page of the same site. */
export const MessageSuggestion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reply'), text: z.string().trim().min(1).max(80) }),
  z.object({
    kind: z.literal('link'),
    title: z.string().trim().min(1).max(40),
    url: z.url({ protocol: /^https?$/ }).max(1000),
  }),
]);
export type MessageSuggestion = z.infer<typeof MessageSuggestion>;

export const MAX_MESSAGE_CARDS = 6;
export const MAX_MESSAGE_SUGGESTIONS = 4;

export const MessageUi = z.object({
  cards: z.array(MessageCard).max(MAX_MESSAGE_CARDS).optional(),
  suggestions: z.array(MessageSuggestion).max(MAX_MESSAGE_SUGGESTIONS).optional(),
});
export type MessageUi = z.infer<typeof MessageUi>;
