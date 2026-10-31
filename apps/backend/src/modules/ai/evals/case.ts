import { z } from 'zod';
import { AccommodationDetails } from '@agent-sales/contracts';

const Outcome = z
  .enum(['answered', 'fallback', 'unknown', 'handoff'])
  // "unknown" is the model's word for "no grounded answer"; the pipeline calls the result "fallback".
  .transform((value) => (value === 'unknown' ? ('fallback' as const) : value));

const Turn = z.union([
  z.object({ customer: z.string().min(1) }).strict(),
  z.object({ bot: z.string().min(1) }).strict(),
]);

/** The final structured reply the model returns in fake mode (`FinalReply`; action steps go through tools). */
const FakeReply = z
  .object({
    outcome: z.enum(['answer', 'unknown', 'handoff']),
    reply: z.string(),
    sources: z.array(z.string()).default([]),
    /** Ids from the product "images" lists, e.g. `p:eval-product-1:0` (fixture products get stable ids). */
    imageIds: z.array(z.string()).default([]),
  })
  .strict();

/** A tool call the fake model makes on its first call, before the final reply. */
const FakeToolCall = z
  .object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).default({}) })
  .strict();

const Variant = z
  .object({
    name: z.string(),
    sku: z.string().optional(),
    price: z.number().int().min(0),
    stock: z.number().int().min(0).default(10),
  })
  .strict();

const Product = z
  .object({
    name: z.string(),
    code: z.string().optional(),
    description: z.string().default(''),
    instructions: z.string().default(''),
    variants: z.array(Variant).min(1),
    /** https picture URLs the bot may send for this product. */
    images: z.array(z.string().url()).default([]),
    accommodation: AccommodationDetails.optional(),
  })
  .strict();

const BotFixture = z
  .object({
    name: z.string().default('Bot'),
    industry: z.string().default('retail'),
    mission: z.string().default(''),
    greeting: z.string().default('Dạ em chào anh/chị ạ'),
    selfPronoun: z.string().default('em'),
    customerPronoun: z.string().default('anh/chị'),
    fallbackMessage: z
      .string()
      .default('Dạ em chưa có thông tin này, anh/chị để lại số điện thoại để nhân viên hỗ trợ ạ.'),
    handoffMessage: z
      .string()
      .default('Dạ em đã chuyển cuộc trò chuyện cho nhân viên, sẽ có người hỗ trợ anh/chị ạ.'),
    creativity: z.enum(['strict', 'balanced', 'creative']).default('balanced'),
    modelTier: z.enum(['basic', 'smart', 'pro', 'neo']).default('smart'),
    language: z.enum(['vi', 'en']).default('vi'),
    replyLength: z.enum(['veryShort', 'short', 'detailed']).default('short'),
    tone: z.enum(['friendly', 'formal']).default('friendly'),
    allowEmoji: z.boolean().default(false),
    placeholders: z.record(z.string(), z.string()).default({}),
    profile: z
      .object({
        fields: z.record(z.string(), z.string()).default({}),
        notes: z.string().default(''),
      })
      .strict()
      .default({ fields: {}, notes: '' }),
  })
  .strict();

const Expect = z
  .object({
    outcome: Outcome.optional(),
    /** The reply must NOT end with this outcome (e.g. `handoff`: an insult is not a handoff request). */
    outcome_not: Outcome.optional(),
    contains_any: z.array(z.string().min(1)).optional(),
    contains_all: z.array(z.string().min(1)).optional(),
    not_contains: z.array(z.string().min(1)).optional(),
    /** Text → the most times it may appear in the reply (case-insensitive), e.g. a repeated pronoun. */
    max_occurrences: z.record(z.string().min(1), z.number().int().min(0)).optional(),
    /** Regular expressions (case-insensitive) that must not match the reply. */
    not_matches: z
      .array(
        z
          .string()
          .min(1)
          .refine((p) => {
            try {
              new RegExp(p, 'iu');
              return true;
            } catch {
              return false;
            }
          }, 'invalid regular expression'),
      )
      .optional(),
    /** `none`: no guardrail may have fired, so the prompt itself produced the answer. */
    guardrail: z.literal('none').optional(),
    numbers_only_from_sources: z.boolean().optional(),
    max_lines: z.number().int().min(1).optional(),
    no_greeting: z.boolean().optional(),
    /** At least this many pictures must be sent with the reply. */
    images_min: z.number().int().min(1).optional(),
    /**
     * Fake mode: tool calls made on the first model call. Absent, a case with products browses the
     * catalog (`search_products` without a query), as the real model does before quoting a price.
     */
    fake_tool_calls: z.array(FakeToolCall).optional(),
    fake_reply: FakeReply.optional(),
  })
  .strict();

/** One eval case (apps/backend/evals/<group>/*.yaml). */
export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
    group: z.string().min(1),
    tags: z.array(z.string()).default([]),
    bot: BotFixture.default(BotFixture.parse({})),
    faqs: z.array(z.object({ question: z.string(), answer: z.string() }).strict()).default([]),
    situations: z
      .array(
        z
          .object({
            title: z.string(),
            trigger: z.string().optional(),
            content: z.string(),
            section: z.enum(['general', 'after_order']).default('general'),
          })
          .strict(),
      )
      .default([]),
    products: z.array(Product).default([]),
    conversation: z
      .array(Turn)
      .min(1)
      .refine((turns) => 'customer' in (turns.at(-1) ?? {}), {
        message: 'the last turn must be a customer message',
      }),
    expect: Expect,
  })
  .strict();
export type EvalCase = z.infer<typeof EvalCase>;
export type EvalExpect = z.infer<typeof Expect>;
export type FakeReply = z.infer<typeof FakeReply>;
export type FakeToolCall = z.infer<typeof FakeToolCall>;
export type EvalOutcome = 'answered' | 'fallback' | 'handoff';

export const isCritical = (c: EvalCase): boolean => c.tags.includes('critical');
