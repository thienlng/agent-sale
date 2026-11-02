import { z } from 'zod';

/** Bot API actions: HTTP APIs the shop owner declares and the bot may call (docs/actions.md). */

export const ActionParamType = z.enum(['string', 'number', 'boolean']);
export const ActionParamLocation = z.enum(['path', 'query', 'header', 'body']);
export const ActionParam = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
  type: ActionParamType,
  location: ActionParamLocation,
  required: z.boolean(),
  description: z.string().min(1).max(300),
});
export type ActionParam = z.infer<typeof ActionParam>;

export const ActionResponseField = z.object({
  /** A key, or a dotted path (`items.code`) into lists and objects. */
  name: z
    .string()
    .min(1)
    .max(60)
    .refine(
      (n) =>
        n
          .split('.')
          .every((s) => s !== '' && s !== '__proto__' && s !== 'constructor' && s !== 'prototype'),
      'Invalid field path',
    ),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string().min(1).max(300),
});
export type ActionResponseField = z.infer<typeof ActionResponseField>;

export const ActionResponse = z.object({
  statusCode: z.number().int().min(100).max(599),
  fields: z.array(ActionResponseField).max(30),
});
export type ActionResponse = z.infer<typeof ActionResponse>;

export const ActionAuth = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('api_key'),
    headerName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,39}$/),
  }),
  z.object({ kind: z.literal('bearer') }),
]);
export type ActionAuth = z.infer<typeof ActionAuth>;

export const ActionMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type ActionMethod = z.infer<typeof ActionMethod>;

const PLACEHOLDER = /\{([^{}]+)\}/g;

const RESERVED_HEADERS = new Set([
  'host',
  'authorization',
  'cookie',
  'content-length',
  'content-type',
  'idempotency-key',
  'accept',
]);
const RESERVED_HEADER_PREFIXES = ['proxy-', 'sec-'];

/** Rules that need several fields at once; the facade re-applies them to the merged result of a patch. */
function checkAction(
  a: { url: string; method: string; params: ActionParam[]; auth: ActionAuth },
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  const authHeader = a.auth.kind === 'api_key' ? a.auth.headerName.toLowerCase() : null;
  for (const [i, p] of a.params.entries()) {
    const lower = p.name.toLowerCase();
    if (names.has(lower))
      ctx.addIssue({
        code: 'custom',
        path: ['params', i, 'name'],
        message: 'Duplicate param name',
      });
    names.add(lower);
    if (
      p.location === 'header' &&
      (RESERVED_HEADERS.has(lower) ||
        RESERVED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
        lower === authHeader)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['params', i, 'name'],
        message: 'Reserved header name',
      });
    if (p.location === 'body' && a.method === 'GET')
      ctx.addIssue({
        code: 'custom',
        path: ['params', i, 'location'],
        message: 'Body params are not allowed on GET',
      });
  }
  const pathParams = new Set(a.params.filter((p) => p.location === 'path').map((p) => p.name));
  for (const [, name] of a.url.matchAll(PLACEHOLDER))
    if (!name || !pathParams.has(name))
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `{${name}} needs a path param with the same name`,
      });
}

const ActionBase = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1000),
  /** HTTPS only; `{param}` placeholders are filled from `path` params. */
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => {
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'A valid HTTPS URL is required'),
  method: ActionMethod,
  params: z.array(ActionParam).max(20),
  responses: z.array(ActionResponse).max(10),
  auth: ActionAuth,
  /** Write-only: sealed at rest, never returned. On update `''` clears it, absent keeps it. */
  authSecret: z.string().max(2000).optional(),
  requiresConfirm: z.boolean(),
  enabled: z.boolean(),
});

export const ActionInput = ActionBase.superRefine(checkAction);
export type ActionInput = z.infer<typeof ActionInput>;

/** The issue message of a draft whose URL query or header param names look like a secret. */
export const SECRET_IN_DRAFT = 'secret_in_draft';

/** One word of a name (`X-Api-Key` → x, api, key; `accessToken` → access, token) that marks a secret. */
const SECRET_WORD =
  /^(?:api)?key$|^token$|^secret$|^password$|^passwd$|^signature$|^sig$|^auth(?:orization|entication|n|z)?$/;

/** Whether a URL query key or header name looks like it carries a secret. */
export function looksLikeSecretName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return (
    words.some((w) => SECRET_WORD.test(w)) ||
    /token|secret|password|signature|apikey/.test(words.join(''))
  );
}

/** The draft refuses secret-looking URL query keys and header params: secrets go in the form. */
function checkNoSecretNames(a: { url: string; params: ActionParam[] }, ctx: z.RefinementCtx): void {
  let keys: string[] = [];
  try {
    keys = [...new URL(a.url).searchParams.keys()];
  } catch {
    // The URL rule already reports it.
  }
  if (keys.some(looksLikeSecretName))
    ctx.addIssue({ code: 'custom', path: ['url'], message: SECRET_IN_DRAFT });
  for (const [i, p] of a.params.entries())
    if (p.location === 'header' && looksLikeSecretName(p.name))
      ctx.addIssue({ code: 'custom', path: ['params', i, 'name'], message: SECRET_IN_DRAFT });
}

const StrictActionAuth = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('api_key'),
      headerName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,39}$/),
    })
    .strict(),
  z.object({ kind: z.literal('bearer') }).strict(),
]);

/**
 * What the owner assistant may draft: disabled, no secret (T-174, spec C5 §7.1). Strict all the
 * way down, so an `authSecret` key or a nested `auth.token` is rejected instead of stripped, and
 * secret-looking URL query keys or header params are refused (`secret_in_draft`). The owner types
 * the secret in the form, tests the action and turns it on.
 */
export const ActionAssistantDraft = ActionBase.omit({ authSecret: true })
  .extend({
    enabled: z.literal(false),
    params: z.array(ActionParam.strict()).max(20),
    responses: z
      .array(
        ActionResponse.extend({ fields: z.array(ActionResponseField.strict()).max(30) }).strict(),
      )
      .max(10),
    auth: StrictActionAuth,
  })
  .strict()
  .superRefine(checkAction)
  .superRefine(checkNoSecretNames);
export type ActionAssistantDraft = z.infer<typeof ActionAssistantDraft>;

/** Shape of a patch; the facade validates the merged result with `ActionInput`. */
export const UpdateActionRequest = ActionBase.partial();
export type UpdateActionRequest = z.infer<typeof UpdateActionRequest>;
export const CreateActionRequest = ActionInput;
export type CreateActionRequest = ActionInput;

export const ActionDto = ActionBase.omit({ authSecret: true }).extend({
  id: z.uuid(),
  botId: z.uuid(),
  hasSecret: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ActionDto = z.infer<typeof ActionDto>;
export const ActionListResponse = z.object({ data: z.array(ActionDto) });
export type ActionListResponse = z.infer<typeof ActionListResponse>;

export const ActionArgs = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type ActionArgs = z.infer<typeof ActionArgs>;

export const ActionTestRequest = z.object({ args: ActionArgs });
export type ActionTestRequest = z.infer<typeof ActionTestRequest>;

/**
 * "Thử gọi" on an unsaved or edited form: the draft itself is executed, so the owner can iterate
 * before saving. `actionId` (when editing) lets a blank `authSecret` fall back to the stored one.
 */
export const ActionDraftTestRequest = z.object({
  action: ActionInput,
  actionId: z.uuid().optional(),
  args: ActionArgs,
});
export type ActionDraftTestRequest = z.infer<typeof ActionDraftTestRequest>;

export const ActionErrorCode = z.enum([
  'timeout',
  'blocked_host',
  'too_large',
  'bad_status',
  'invalid_args',
  'network',
  'disabled',
  'not_found',
]);
export type ActionErrorCode = z.infer<typeof ActionErrorCode>;

export const ActionTestResult = z.object({
  ok: z.boolean(),
  statusCode: z.number().int().nullable(),
  data: z.unknown().nullable(),
  errorCode: ActionErrorCode.nullable(),
  latencyMs: z.number().int().min(0),
});
export type ActionTestResult = z.infer<typeof ActionTestResult>;
