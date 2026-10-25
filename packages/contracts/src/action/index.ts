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
  name: z.string().min(1).max(60),
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

/** Rules that need several fields at once; the facade re-applies them to the merged result of a patch. */
function checkAction(a: { url: string; params: ActionParam[] }, ctx: z.RefinementCtx): void {
  const names = new Set<string>();
  for (const [i, p] of a.params.entries()) {
    if (names.has(p.name))
      ctx.addIssue({
        code: 'custom',
        path: ['params', i, 'name'],
        message: 'Duplicate param name',
      });
    names.add(p.name);
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
