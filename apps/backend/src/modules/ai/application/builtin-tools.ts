import { SaasRequestKind } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { ActionOutcome, BotActionView } from '../../action/api/index.js';
import type { SaasFacade } from '../../saas/api/index.js';

/** Built-in tools run in-process (ADR-014 §3): no URL, no `bot_actions` row, no run log. */
export const BUILTIN_PREFIX = 'builtin.';
export const SAAS_REQUEST_TOOL = 'builtin.saas.request';

type Args = Record<string, string | number | boolean>;
export type BuiltinInvoker = (args: Args) => Promise<ActionOutcome>;

const param = (name: string, required: boolean, description: string) => ({
  name,
  type: 'string' as const,
  location: 'body' as const,
  required,
  description,
});

/** The `<actions>` entry of a SaaS bot: record a demo / trial / consultation request. */
export const saasRequestView: BotActionView = {
  id: SAAS_REQUEST_TOOL,
  name: 'Record a demo, free trial or consultation request',
  description:
    'Records that the customer wants a product demo, a free trial account or a consultation, so staff contact them. Call it once the customer asked for one and gave their name and a phone number or an email; call it again when they add or correct details. One request per kind per conversation. Staff schedule and confirm: never promise a time or an account yourself.',
  method: 'POST',
  requiresConfirm: false,
  params: [
    param('kind', true, '"demo", "trial" or "consultation"'),
    param('name', true, "The customer's name as they wrote it"),
    param('phone', false, 'Phone number the customer wrote (phone or email is required)'),
    param('email', false, 'Email the customer wrote (phone or email is required)'),
    param('company', false, 'Company or shop name'),
    param('teamSize', false, 'How many people will use it, as the customer said'),
    param('need', false, 'What they want to solve, in a short sentence'),
    param('preferredTime', false, 'When they would like to be contacted or see the demo'),
    param('planInterest', false, 'The plan they asked about'),
  ],
  responseFields: [
    { name: 'recorded', type: 'boolean', description: 'true when the request is saved' },
    {
      name: 'status',
      type: 'string',
      description: '"new" (staff will contact the customer) or a later stage staff already set',
    },
  ],
};

const digits = (v: string) => v.replace(/\D/g, '');
/** A national-form tail: "+84 983…" and "0983…" both end with the same 9 digits. */
const phoneTail = (v: string) => digits(v).slice(-9);

/**
 * Contact details must come from the customer's own words, never from the model: a phone needs
 * its last 9 digits in a customer message, an email must appear verbatim.
 */
export function contactVouched(args: Args, customerTexts: readonly string[]): boolean {
  const phone = typeof args['phone'] === 'string' ? args['phone'].trim() : '';
  const email = typeof args['email'] === 'string' ? args['email'].trim().toLowerCase() : '';
  if (
    phone &&
    (phoneTail(phone).length < 9 ||
      !customerTexts.some((t) => digits(t).includes(phoneTail(phone))))
  )
    return false;
  if (email && !customerTexts.some((t) => t.toLowerCase().includes(email))) return false;
  return true;
}

/**
 * Built-in tools a bot of `industry` gets, with their in-process invokers. Test (playground)
 * calls never write: the facade validates and answers as if recorded.
 */
export function builtinTools(input: {
  industry: string;
  saas: SaasFacade | undefined;
  ws: WorkspaceId;
  conversationId: string;
  isTest: boolean;
  customerTexts: readonly string[];
}): { views: BotActionView[]; invokers: Map<string, BuiltinInvoker> } {
  const { saas } = input;
  if (input.industry !== 'saas' || !saas) return { views: [], invokers: new Map() };
  const invoke: BuiltinInvoker = async (args) => {
    const kind = SaasRequestKind.safeParse(args['kind']);
    if (!kind.success || !contactVouched(args, input.customerTexts))
      return { ok: false, errorCode: 'invalid_args' };
    const { kind: _kind, ...rest } = args;
    const details = Object.fromEntries(
      Object.entries(rest)
        .filter(([, v]) => v !== '' && v !== null)
        .map(([k, v]) => [k, String(v)]),
    );
    let r: Awaited<ReturnType<SaasFacade['recordBotRequest']>>;
    try {
      r = await saas.recordBotRequest(input.ws, {
        conversationId: input.conversationId,
        contactId: null,
        kind: kind.data,
        details,
        preview: input.isTest,
      });
    } catch {
      // The customer's reply must not fail: the model says it could not record it right now.
      return { ok: false, errorCode: 'network' };
    }
    if (r.outcome === 'invalid') return { ok: false, errorCode: 'invalid_args' };
    return {
      ok: true,
      statusCode: 200,
      data: { recorded: true, kind: kind.data, status: r.request?.status ?? 'new' },
    };
  };
  return { views: [saasRequestView], invokers: new Map([[SAAS_REQUEST_TOOL, invoke]]) };
}
