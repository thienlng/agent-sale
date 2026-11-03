import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import { SaasRequestKind } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';

import type { SaasFacade } from '../../saas/api/index.js';
import { type ActionCall, safeJson } from './action-tools.js';

/**
 * The SaaS vertical's built-in tool (ADR-020): a bot of a `saas` business records a demo / trial /
 * consultation request on the customer, in-process through the saas facade. No URL, no
 * `bot_actions` row, no run log, no confirmation turn: staff contact, schedule and convert.
 */
export const SAAS_REQUEST_TOOL = 'record_saas_request';
/** The name the call carries in the reply's `actions` list (like an owner action's name). */
export const SAAS_REQUEST_NAME = 'Record a demo, free trial or consultation request';

const text = (max: number) => z.string().max(max);

const SaasRequestInput = z.object({
  kind: SaasRequestKind.describe('"demo", "trial" or "consultation"'),
  name: text(120).describe("The customer's name as they wrote it"),
  phone: text(40).describe('Phone number the customer wrote'),
  email: text(200).optional().describe('Email the customer wrote'),
  company: text(200).optional().describe('Company or shop name'),
  teamSize: text(60).optional().describe('How many people will use it, as the customer said'),
  need: text(2000).optional().describe('What they want to solve, in a short sentence'),
  preferredTime: text(200)
    .optional()
    .describe('When they would like to be contacted or see the demo'),
  planInterest: text(200).optional().describe('The plan they asked about'),
});
type SaasRequestArgs = z.infer<typeof SaasRequestInput>;

export const SAAS_REQUEST_DEFINITION: ToolDefinition = {
  name: SAAS_REQUEST_TOOL,
  description:
    'Records that the customer wants a product demo, a free trial account or a consultation, so staff contact them. Call it once the customer asked for one and gave their name and a phone number; call it again when they add or correct details. Returns recorded true when the request is saved on the customer. Staff schedule and confirm: never promise a time or an account yourself.',
  input: SaasRequestInput,
};

const digits = (v: string) => v.replace(/\D/g, '');
/** A national-form tail: "+84 983…" and "0983…" both end with the same 9 digits. */
const phoneTail = (v: string) => digits(v).slice(-9);

const escapeRegExp = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `email` as a whole address in `text`: not the tail of a longer local part or domain. */
const hasEmail = (text: string, email: string): boolean =>
  new RegExp(
    `(?<![\\p{L}\\p{N}._%+-])${escapeRegExp(email)}(?![\\p{L}\\p{N}_%+-]|\\.[\\p{L}\\p{N}])`,
    'iu',
  ).test(text);

/**
 * Contact details must come from the customer's own words, never from the model: a phone needs
 * its last 9 digits in a customer message, an email must appear as a whole address.
 */
export function contactVouched(
  args: { phone?: unknown; email?: unknown },
  customerTexts: readonly string[],
): boolean {
  const phone = typeof args.phone === 'string' ? args.phone.trim() : '';
  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
  if (
    phone &&
    (phoneTail(phone).length < 9 ||
      !customerTexts.some((t) => digits(t).includes(phoneTail(phone))))
  )
    return false;
  if (email && !customerTexts.some((t) => hasEmail(t, email))) return false;
  return true;
}

/** What one turn's SaaS tool needs; built by the reply pipeline only for `saas` bots. */
export interface SaasToolContext {
  facade: SaasFacade;
  ws: WorkspaceId;
  /** Playground: the facade validates and answers as if recorded, nothing is written. */
  isTest: boolean;
  /** What the customer wrote: the only text that vouches for a phone or an email. */
  customerTexts: readonly string[];
  /** The turn's call list (the reply's `actions`): the tool adds its own entry. */
  calls: ActionCall[];
  onError?(error: unknown): void;
}

/** `record_saas_request`: a write, run one by one by the tool runner. */
export function saasTools(ctx: SaasToolContext): {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
} {
  const done = (ok: boolean, value: unknown) => {
    ctx.calls.push({ name: SAAS_REQUEST_NAME, ok, statusCode: ok ? 200 : null });
    return { content: safeJson(value), ok };
  };
  const tool: RunnableTool = {
    name: SAAS_REQUEST_TOOL,
    readOnly: false,
    schema: SaasRequestInput,
    run: async (input) => {
      const { kind, ...rest } = input as SaasRequestArgs;
      if (!contactVouched(rest, ctx.customerTexts))
        return done(false, { ok: false, error: 'contact_not_from_customer' });
      const details = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
      );
      let r: Awaited<ReturnType<SaasFacade['recordBotRequest']>>;
      try {
        r = await ctx.facade.recordBotRequest(ctx.ws, { kind, details, preview: ctx.isTest });
      } catch (error) {
        // The customer's reply must not fail: the model says it could not record it right now.
        ctx.onError?.(error);
        return done(false, { ok: false, error: 'not_recorded_retry_later' });
      }
      if (r.outcome === 'invalid')
        return done(false, { ok: false, error: 'invalid_arguments', problems: r.problems });
      return done(true, { ok: true, recorded: true, kind });
    },
  };
  return { definitions: [SAAS_REQUEST_DEFINITION], runnable: [tool] };
}
