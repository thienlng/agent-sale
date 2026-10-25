import {
  ActionInput,
  type ActionArgs,
  type ActionDto,
  type ActionMethod,
  type ActionParam,
  type ActionResponseField,
} from '@agent-sales/contracts';

/** Text-only form state; numbers are parsed on submit so half-typed input is never lost. */
export interface ParamRow {
  key: string;
  name: string;
  type: ActionParam['type'];
  location: ActionParam['location'];
  required: boolean;
  description: string;
}
export interface FieldRow {
  key: string;
  name: string;
  type: ActionResponseField['type'];
  description: string;
}
export interface ResponseRow {
  key: string;
  statusCode: string;
  fields: FieldRow[];
}
export interface ActionForm {
  name: string;
  description: string;
  url: string;
  method: ActionMethod;
  authKind: 'none' | 'api_key' | 'bearer';
  headerName: string;
  /** Write-only: empty means "keep the saved secret". */
  secret: string;
  hasSecret: boolean;
  params: ParamRow[];
  responses: ResponseRow[];
  requiresConfirm: boolean;
  enabled: boolean;
}

let counter = 0;
const nextKey = () => `r${(counter += 1)}`;

export const emptyParam = (): ParamRow => ({
  key: nextKey(),
  name: '',
  type: 'string',
  location: 'query',
  required: true,
  description: '',
});
export const emptyField = (): FieldRow => ({
  key: nextKey(),
  name: '',
  type: 'string',
  description: '',
});
export const emptyResponse = (): ResponseRow => ({
  key: nextKey(),
  statusCode: '200',
  fields: [],
});

/** Writes change data, so confirmation is on by default for everything but GET. */
export const confirmDefault = (method: ActionMethod): boolean => method !== 'GET';

export function newForm(): ActionForm {
  return {
    name: '',
    description: '',
    url: '',
    method: 'GET',
    authKind: 'none',
    headerName: 'X-API-Key',
    secret: '',
    hasSecret: false,
    params: [],
    responses: [],
    requiresConfirm: false,
    enabled: true,
  };
}

export function formFromDto(dto: ActionDto): ActionForm {
  return {
    name: dto.name,
    description: dto.description,
    url: dto.url,
    method: dto.method,
    authKind: dto.auth.kind,
    headerName: dto.auth.kind === 'api_key' ? dto.auth.headerName : 'X-API-Key',
    secret: '',
    hasSecret: dto.hasSecret,
    params: dto.params.map((p) => ({ ...p, key: nextKey() })),
    responses: dto.responses.map((r) => ({
      key: nextKey(),
      statusCode: String(r.statusCode),
      fields: r.fields.map((f) => ({ ...f, key: nextKey() })),
    })),
    requiresConfirm: dto.requiresConfirm,
    enabled: dto.enabled,
  };
}

/**
 * The request body for the API. `secret` is sent only when typed (absent keeps the saved one);
 * switching authentication off clears a saved secret.
 */
export function toInput(form: ActionForm): unknown {
  const auth =
    form.authKind === 'api_key'
      ? { kind: 'api_key', headerName: form.headerName.trim() }
      : { kind: form.authKind };
  const body: Record<string, unknown> = {
    name: form.name,
    description: form.description,
    url: form.url,
    method: form.method,
    params: form.params.map(({ key: _key, ...p }) => p),
    responses: form.responses.map((r) => ({
      statusCode: r.statusCode.trim() === '' ? Number.NaN : Number(r.statusCode),
      fields: r.fields.map(({ key: _key, ...f }) => f),
    })),
    auth,
    requiresConfirm: form.requiresConfirm,
    enabled: form.enabled,
  };
  if (form.authKind === 'none') {
    if (form.hasSecret) body.authSecret = '';
  } else if (form.secret !== '') body.authSecret = form.secret;
  return body;
}

export type ErrorKey =
  | 'required'
  | 'https'
  | 'placeholder'
  | 'duplicate'
  | 'reservedHeader'
  | 'bodyOnGet'
  | 'paramName'
  | 'headerName'
  | 'tooLong'
  | 'statusCode'
  | 'invalid';
export interface FieldError {
  key: ErrorKey;
  vars?: Record<string, string>;
}

/** Row ids in error paths use the row index; the UI looks errors up by the same dotted path. */
function classify(issue: { code: string; path: PropertyKey[]; message: string }): FieldError {
  const path = issue.path.map(String);
  const last = path.at(-1);
  if (issue.code === 'custom' && issue.message === 'Duplicate param name')
    return { key: 'duplicate' };
  if (issue.message === 'Reserved header name') return { key: 'reservedHeader' };
  if (issue.message === 'Body params are not allowed on GET') return { key: 'bodyOnGet' };
  const placeholder = /^\{(.*)\} needs a path param/.exec(issue.message);
  if (placeholder) return { key: 'placeholder', vars: { name: `{${placeholder[1]}}` } };
  if (last === 'url') return { key: issue.message.includes('HTTPS') ? 'https' : 'tooLong' };
  if (last === 'statusCode') return { key: 'statusCode' };
  if (issue.code === 'too_big') return { key: 'tooLong' };
  if (issue.code === 'too_small') return { key: 'required' };
  if (last === 'name' && path[0] === 'params') return { key: 'paramName' };
  if (last === 'headerName') return { key: 'headerName' };
  return { key: 'invalid' };
}

/** Validates with the contracts schema (the same one the API applies); returns errors by dotted path. */
export function validateForm(form: ActionForm): Record<string, FieldError> {
  const result = ActionInput.safeParse(toInput(form));
  if (result.success) return {};
  const errors: Record<string, FieldError> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= classify(issue);
  }
  return errors;
}

/** Sample arguments from the typed values: blanks are skipped, numbers/booleans converted. */
export function buildArgs(
  params: Pick<ActionParam, 'name' | 'type'>[],
  values: Record<string, string>,
): ActionArgs {
  const args: ActionArgs = {};
  for (const p of params) {
    const raw = (values[p.name] ?? '').trim();
    if (raw === '') continue;
    if (p.type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) args[p.name] = n;
    } else if (p.type === 'boolean') args[p.name] = raw === 'true';
    else args[p.name] = raw;
  }
  return args;
}
