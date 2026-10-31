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

/** A tool call of a scripted model turn (fake mode). */
const FakeToolCall = z
  .object({ name: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) })
  .strict();

/**
 * One scripted model response (fake mode). `tool_calls` makes the loop run those tools and call the
 * model again; a turn without tool calls ends the loop and `text` is the free-text final answer
 * (empty: no answer, so the bot's fallback message is sent). Text next to tool calls is the
 * model's commentary, used as the lead-in sentence when the turn ends with `handoff`.
 */
const FakeTurn = z
  .object({
    text: z.string().optional(),
    tool_calls: z.array(FakeToolCall).min(1).optional(),
  })
  .strict()
  .refine((t) => t.text !== undefined || t.tool_calls !== undefined, {
    message: 'a fake turn needs text or tool_calls',
  });

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
    /** The bot closes orders itself (`prepare_order` / `confirm_order`, setting "Chốt đơn"). */
    orderTaking: z.boolean().default(false),
    /** The bot's default shipping fee in VND; null: the summary says "Phí ship: shop báo sau". */
    orderShippingFeeVnd: z.number().int().min(0).nullable().default(null),
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
    /** At least this many pictures sent in the turn (every message together). */
    images_min: z.number().int().min(1).optional(),
    /** At least this many messages delivered in the turn (`send_message` ones and the final one). */
    messages_min: z.number().int().min(1).optional(),
    /** At least this many delivered messages carry a picture (e.g. one message per product). */
    image_messages_min: z.number().int().min(1).optional(),
    /** No delivered message carries more pictures than this. */
    images_per_message_max: z.number().int().min(0).optional(),
    /** Each of these tools ran at least once this turn (whatever its result). */
    steps_include: z.array(z.string().min(1)).optional(),
    /** None of these tools ran this turn. */
    steps_exclude: z.array(z.string().min(1)).optional(),
    /** Each of these tools ran at least once with an ok result. */
    steps_succeeded: z.array(z.string().min(1)).optional(),
    /** None of these tools returned an ok result (it may have run and failed). */
    steps_not_succeeded: z.array(z.string().min(1)).optional(),
    /** A delivered message carries exactly these quick-reply titles, in order. */
    quick_replies: z.array(z.string().min(1)).min(1).optional(),
    /** Whether the turn created an order (`confirm_order` succeeded). */
    order_created: z.boolean().optional(),
  })
  .strict();

const OrderItem = z.object({ sku: z.string().min(1), qty: z.number().int().min(1) }).strict();

/** A summary the customer already received: the draft waiting for their answer this turn. */
const OrderDraft = z
  .object({
    items: z.array(OrderItem).min(1),
    recipient: z.object({ name: z.string(), phone: z.string(), address: z.string() }).strict(),
    note: z.string().optional(),
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
    /**
     * Needs `bot.orderTaking`: an order summary stored before this turn (the bot's previous turn
     * sent it), so the turn may call `confirm_order` / `cancel_order_draft`.
     */
    order_draft: OrderDraft.optional(),
    conversation: z
      .array(Turn)
      .min(1)
      .refine((turns) => 'customer' in (turns.at(-1) ?? {}), {
        message: 'the last turn must be a customer message',
      }),
    expect: Expect,
    /**
     * Fake mode only: the scripted model responses of the turn, in order (the history summarizer
     * is answered separately). Required in fake mode, ignored by `--live`.
     */
    fake_turns: z.array(FakeTurn).min(1).optional(),
  })
  .strict()
  .refine((c) => !c.order_draft || c.bot.orderTaking, {
    message: 'order_draft needs bot.orderTaking: true',
    path: ['order_draft'],
  });
export type EvalCase = z.infer<typeof EvalCase>;
export type EvalExpect = z.infer<typeof Expect>;
export type FakeTurn = z.infer<typeof FakeTurn>;
export type FakeToolCall = z.infer<typeof FakeToolCall>;
export type EvalOutcome = 'answered' | 'fallback' | 'handoff';

export const isCritical = (c: EvalCase): boolean => c.tags.includes('critical');
