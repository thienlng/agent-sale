import { z } from 'zod';

const Outcome = z
  .enum(['answered', 'fallback', 'unknown', 'handoff'])
  // "unknown" is the model's word for "no grounded answer"; the pipeline calls the result "fallback".
  .transform((value) => (value === 'unknown' ? ('fallback' as const) : value));

const Turn = z.union([
  z.object({ customer: z.string().min(1) }).strict(),
  z.object({ bot: z.string().min(1) }).strict(),
]);

/** What the pipeline's model call returns in fake mode (the structured output of `ModelReply`). */
const FakeReply = z
  .object({
    outcome: z.enum([
      'answer',
      'unknown',
      'handoff',
      'call_action',
      'confirm_action',
      'cancel_action',
    ]),
    reply: z.string(),
    sources: z.array(z.string()).default([]),
  })
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
    contains_any: z.array(z.string().min(1)).optional(),
    contains_all: z.array(z.string().min(1)).optional(),
    not_contains: z.array(z.string().min(1)).optional(),
    numbers_only_from_sources: z.boolean().optional(),
    max_lines: z.number().int().min(1).optional(),
    no_greeting: z.boolean().optional(),
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
export type EvalOutcome = 'answered' | 'fallback' | 'handoff';

export const isCritical = (c: EvalCase): boolean => c.tags.includes('critical');
