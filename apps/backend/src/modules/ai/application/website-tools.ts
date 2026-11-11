import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import type { MessageCard, MessageSuggestion, ProductDto } from '@agent-sales/contracts';
import { formatVnd } from '@agent-sales/shared';
import { z } from 'zod';

import type { MessageSink } from '../api/reply-options.js';
import { productImages } from '../domain/image-allowlist.js';
import type { NavTarget } from '../domain/page-nav.js';
import { compactProduct } from '../domain/product-view.js';
import { normalizeReplyText } from '../domain/reply-text.js';
import { safeJson } from './action-tools.js';
import type { ImageAllowlist, OutputState } from './output-tools.js';

export const SHOW_PRODUCTS_TOOL = 'show_products';
export const SUGGEST_NEXT_TOOL = 'suggest_next';
const MAX_CARDS = 6;

const ShowProductsInput = z.object({
  text: z.string().trim().min(1).max(500),
  productIds: z.array(z.string().max(64)).min(1).max(MAX_CARDS),
});

const SuggestNextInput = z
  .object({
    replies: z.array(z.string().trim().min(1).max(80)).max(3).optional(),
    links: z
      .array(z.object({ id: z.string().max(10), title: z.string().trim().min(1).max(40) }))
      .max(2)
      .optional(),
  })
  .refine((v) => Boolean(v.replies?.length || v.links?.length), {
    message: 'give replies or links',
  });

const SHOW_PRODUCTS_DEFINITION: ToolDefinition = {
  name: SHOW_PRODUCTS_TOOL,
  description:
    'Website chat only. Sends one message with a short intro text and a row of product cards (picture, name, price, a "learn more" button) built from the catalog: use it when the visitor wants to see or compare several products, plans or packages (2 to 6 ids, copied exactly, of products a catalog tool returned or from <focus_products>). Do not repeat the cards in your answer.',
  input: ShowProductsInput,
};

const SUGGEST_NEXT_DEFINITION: ToolDefinition = {
  name: SUGGEST_NEXT_TOOL,
  description:
    'Website chat only. Buttons under your final answer: up to 3 short follow-up questions the visitor is likely to ask next (in their language, written as the visitor, max 80 characters) and up to 2 links by id from "navigation" in <visitor_page> (title max 40 characters, e.g. "Xem bảng giá"). Call it once, before your final answer; a later call replaces the earlier one.',
  input: SuggestNextInput,
};

/** Longest price note shown next to a card's price. */
const SHORT_NOTE = 24;

/** The card's price line: one price or a range start (with a short note), the note, or nothing. */
export function cardPrice(product: ProductDto, language: 'vi' | 'en'): string {
  const c = compactProduct(product);
  const note = c.priceNote ?? '';
  if (c.fromVnd !== undefined && c.fromVnd > 0) {
    const price =
      c.toVnd === undefined || c.toVnd === c.fromVnd
        ? formatVnd(c.fromVnd)
        : `${language === 'en' ? 'From' : 'Từ'} ${formatVnd(c.fromVnd)}`;
    // A short note goes next to the price ("/ tháng"); a long one stays in the chat.
    return note && note.length <= SHORT_NOTE ? `${price} ${note}` : price;
  }
  return note.slice(0, 80);
}

const KNOWN_LIMIT = 12;

/**
 * A product the model may show, by id; a model that garbled a near-identical id (UUIDv7s of
 * products created together share their first characters) may also name it by its code or name.
 */
function shownProduct(
  products: ReadonlyMap<string, ProductDto>,
  ref: string,
): ProductDto | undefined {
  const exact = products.get(ref);
  if (exact) return exact;
  const key = ref.toLowerCase();
  const matches = [...products.values()].filter(
    (p) =>
      p.id.toLowerCase() === key || p.code.toLowerCase() === key || p.name.toLowerCase() === key,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export interface WebsiteToolContext {
  /** Products the model may show: focus products and every product a catalog tool listed. */
  products: ReadonlyMap<string, ProductDto>;
  navigation: readonly NavTarget[];
  language: 'vi' | 'en';
  allowlist: ImageAllowlist;
  state: OutputState;
  sink?: MessageSink;
}

/**
 * The website-only tools (ADR-029): `show_products` (cards from catalog data, sent at once) and,
 * when the page offers places to go or follow-ups make sense, `suggest_next` (buttons kept for the
 * final message). The model passes ids only: prices, pictures and URLs come from the server.
 */
export function websiteTools(ctx: WebsiteToolContext): {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
} {
  const { state } = ctx;

  const showProducts: RunnableTool = {
    name: SHOW_PRODUCTS_TOOL,
    readOnly: false,
    schema: ShowProductsInput,
    run: async (input) => {
      const args = input as z.infer<typeof ShowProductsInput>;
      const cards: MessageCard[] = [];
      const unknown: string[] = [];
      const shown = new Set<string>();
      for (const id of [...new Set(args.productIds.map((x) => x.trim()))]) {
        const product = shownProduct(ctx.products, id);
        if (!product) {
          unknown.push(id.slice(0, 64));
          continue;
        }
        if (shown.has(product.id)) continue;
        shown.add(product.id);
        const first = productImages([product])[0];
        cards.push({
          productId: product.id,
          title: product.name.slice(0, 120),
          price: cardPrice(product, ctx.language),
          imageUrl: first ? ctx.allowlist.publicUrl(first.url) : null,
        });
      }
      const extra = unknown.length ? { unknownProductIds: unknown } : {};
      if (!cards.length)
        return {
          content: safeJson({
            error: 'unknown_products',
            hint: 'use the ids listed here, or search the catalog first',
            ...extra,
            known: [...ctx.products.values()]
              .slice(0, KNOWN_LIMIT)
              .map((p) => ({ id: p.id, name: p.name })),
          }),
          ok: false,
        };
      const text = normalizeReplyText(args.text);
      const outcome = ctx.sink
        ? await ctx.sink.send({ text, images: [], ui: { cards } })
        : { delivered: 1 };
      if (outcome.delivered <= 0)
        return { content: safeJson({ error: 'not_delivered', ...extra }), ok: false };
      state.sent.push({ text, images: [], ui: { cards }, via: 'send_message' });
      return {
        content: safeJson({
          status: 'sent',
          shown: cards.map((c) => ({ id: c.productId, name: c.title })),
          ...extra,
        }),
      };
    },
  };

  const suggestNext: RunnableTool = {
    name: SUGGEST_NEXT_TOOL,
    readOnly: false,
    schema: SuggestNextInput,
    run: async (input) => {
      const args = input as z.infer<typeof SuggestNextInput>;
      const byId = new Map(ctx.navigation.map((t) => [t.id, t]));
      const unknown: string[] = [];
      const links: MessageSuggestion[] = [];
      for (const link of args.links ?? []) {
        const target = byId.get(link.id.trim());
        if (!target) unknown.push(link.id.slice(0, 10));
        else if (!links.some((l) => l.kind === 'link' && l.url === target.url))
          links.push({ kind: 'link', title: link.title, url: target.url });
      }
      const replies: MessageSuggestion[] = [...new Set(args.replies ?? [])].map((text) => ({
        kind: 'reply',
        text,
      }));
      const suggestions = [...replies, ...links].slice(0, 4);
      state.suggestions = suggestions.length ? suggestions : null;
      return {
        content: safeJson({
          status: suggestions.length ? 'will_show_under_final_answer' : 'nothing_to_show',
          ...(unknown.length ? { unknownLinkIds: unknown } : {}),
        }),
        ok: suggestions.length > 0,
      };
    },
  };

  return {
    definitions: [SHOW_PRODUCTS_DEFINITION, SUGGEST_NEXT_DEFINITION],
    runnable: [showProducts, suggestNext],
  };
}
