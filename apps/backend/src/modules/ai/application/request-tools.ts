import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import type { CustomerRequestKind, RequestProfile } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { z } from 'zod';

import type { BotRequestResult, CrmFacade } from '../../crm/api/index.js';
import { asksForRequest } from '../domain/request-intent.js';
import { weekdayMismatch, weekdayMismatchInText } from '../domain/weekday-date.js';
import { spokenDigits } from './reply-context.js';
import { type ActionCall, safeJson } from './action-tools.js';

/**
 * The built-in request tool of the request industries (ADR-020, generalised for saas, education and
 * spa): the bot records a demo, trial, placement test, appointment or consultation request on the
 * CRM customer, in-process through the crm facade. Its kinds, fields, description and action name
 * come from the industry's `RequestProfile` (contracts). No URL, no `bot_actions` row, no run log,
 * no confirmation turn: staff contact the customer and confirm.
 */
export const REQUEST_TOOL = 'record_request';
/** The saas tool's name before the generalisation: only rendered for older turn traces. */
export const LEGACY_SAAS_REQUEST_TOOL = 'record_saas_request';

const quoted = (kinds: readonly string[]): string => {
  const q = kinds.map((k) => `"${k}"`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q.at(-1)}` : (q[0] ?? '');
};

/**
 * The model-facing input of the profile: `kind` limited to the profile's kinds, then every field of
 * `requestDetailsSchema(industry)` in the same order, all optional strings. The crm writer
 * validates the details (required groups, phone, email, date) and names what is missing.
 */
export function requestInput(profile: RequestProfile): z.ZodObject<z.ZodRawShape> {
  const kinds = profile.kinds as unknown as [CustomerRequestKind, ...CustomerRequestKind[]];
  return z.object({
    kind: z.enum(kinds).describe(quoted(profile.kinds)),
    ...Object.fromEntries(
      profile.fields.map((f) => [f.key, z.string().max(f.max).optional().describe(f.describe)]),
    ),
  });
}

/** The tool definition of the profile (name `record_request`, the profile's description). */
export function requestDefinition(profile: RequestProfile): ToolDefinition {
  return { name: REQUEST_TOOL, description: profile.description, input: requestInput(profile) };
}

const digits = (v: string) => spokenDigits(v).replace(/\D/g, '');
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

/** What one turn's request tool needs; built by the reply pipeline only for request industries. */
export interface RequestToolContext {
  facade: Pick<CrmFacade, 'recordBotRequest'>;
  ws: WorkspaceId;
  /** `requestProfileFor(bot.industry)`: kinds, fields, description and action name. */
  profile: RequestProfile;
  /** Playground: the facade validates and answers as if recorded, nothing is written. */
  isTest: boolean;
  /** What the customer wrote: the only text that vouches for a phone or an email. */
  customerTexts: readonly string[];
  /** The turn's call list (the reply's `actions`): the tool adds its own entry. */
  calls: ActionCall[];
  /** Names of the products the bot saw so far (focus products, search results), read at call time. */
  catalogNames?: () => readonly string[];
  /** The conversation's channel: the source of a customer the request creates (MS-11). */
  channel?: string;
  /** The conversation: the staff task the request opens links it (LM2-8). */
  conversationId?: string | null;
  /** A recorded request's customer, so the caller links the conversation to it (MS-11). */
  onRecorded?(contact: { contactId: string; phoneE164: string }): void;
  onError?(error: unknown): void;
}

/** `record_request`: a write, run one by one by the tool runner. */
export function requestTools(ctx: RequestToolContext): {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
} {
  const definition = requestDefinition(ctx.profile);
  const done = (ok: boolean, value: unknown) => {
    ctx.calls.push({ name: ctx.profile.actionName, ok, statusCode: ok ? 200 : null });
    return { content: safeJson(value), ok };
  };
  const tool: RunnableTool = {
    name: REQUEST_TOOL,
    readOnly: false,
    schema: definition.input,
    run: async (input) => {
      const { kind, ...rest } = input as { kind: CustomerRequestKind } & Record<string, unknown>;
      if (!asksForRequest(ctx.customerTexts))
        return done(false, {
          ok: false,
          error: 'no_request_asked',
          hint: 'The customer has not asked to register, book, try or be called: answer them; record only once they ask.',
        });
      if (!contactVouched(rest, ctx.customerTexts))
        return done(false, { ok: false, error: 'contact_not_from_customer' });
      const date = typeof rest['preferredDate'] === 'string' ? rest['preferredDate'] : '';
      const actual = date
        ? weekdayMismatch(date, ctx.customerTexts)
        : weekdayMismatchInText(ctx.customerTexts, new Date());
      if (actual) return done(false, { ok: false, error: 'weekday_date_mismatch', dateIs: actual });
      const details = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
      );
      let r: BotRequestResult;
      try {
        r = await ctx.facade.recordBotRequest(ctx.ws, {
          kind,
          details,
          preview: ctx.isTest,
          ...(ctx.catalogNames ? { catalogNames: ctx.catalogNames() } : {}),
          ...(ctx.channel ? { channel: ctx.channel } : {}),
          ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
        });
      } catch (error) {
        // The customer's reply must not fail: the model says it could not record it right now.
        ctx.onError?.(error);
        return done(false, { ok: false, error: 'not_recorded_retry_later' });
      }
      if (r.outcome === 'invalid')
        return done(false, { ok: false, error: 'invalid_arguments', problems: r.problems });
      if (r.outcome !== 'preview')
        ctx.onRecorded?.({ contactId: r.contactId, phoneE164: r.phoneE164 });
      return done(true, {
        ok: true,
        recorded: true,
        updated: r.outcome === 'updated',
        kind,
        // LM-13: the details still missing were asked for when the request was first recorded;
        // an update does not ask for them again (the bot asked an adult her age 4 times).
        missing: r.outcome === 'updated' ? [] : r.missing,
        dateLabel: r.dateLabel,
      });
    },
  };
  return { definitions: [definition], runnable: [tool] };
}
