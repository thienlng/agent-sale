import { z } from 'zod';

const MAX_BODY_BYTES = 256_000;
export const MAX_LISTED_MODELS = 30;

export type ProviderModelState = 'ok' | 'auth_required' | 'unavailable';
export interface ProviderModelList {
  models: { id: string }[];
  state: ProviderModelState;
}

export interface ListProviderModelsOptions {
  kind: 'anthropic' | 'openai_compatible' | 'hermes';
  baseURL?: string | undefined;
  apiKey?: string | undefined;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const UNAVAILABLE: ProviderModelList = { models: [], state: 'unavailable' };

const BridgeModels = z.object({ models: z.array(z.object({ id: z.string().min(1).max(200) })) });
const OpenAiModels = z.object({ data: z.array(z.object({ id: z.string().min(1).max(200) })) });

function safeBase(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function cap(ids: { id: string }[]): { id: string }[] {
  const seen = new Set<string>();
  const out: { id: string }[] = [];
  for (const { id } of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id });
    if (out.length >= MAX_LISTED_MODELS) break;
  }
  return out;
}

/**
 * Lists the model ids a provider offers (at most {@link MAX_LISTED_MODELS}, in source order).
 * Never throws and never reports URLs or keys: failures degrade to `unavailable`
 * (or `auth_required` when the Hermes bridge is not signed in to ChatGPT).
 */
export async function listProviderModels(
  options: ListProviderModelsOptions,
): Promise<ProviderModelList> {
  const base =
    options.kind === 'anthropic'
      ? safeBase(options.baseURL ?? 'https://api.anthropic.com')
      : safeBase(options.baseURL);
  if (!base) return UNAVAILABLE;
  const key = options.apiKey?.trim();
  if (options.kind !== 'openai_compatible' && !key) return UNAVAILABLE;

  let url: string;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.kind === 'hermes') {
    url = `${base}/v1/models`;
    headers.Authorization = `Bearer ${key}`;
  } else if (options.kind === 'anthropic') {
    url = `${base}/v1/models?limit=${MAX_LISTED_MODELS}`;
    headers['x-api-key'] = key as string;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    url = `${base}/models`;
    if (key) headers.Authorization = `Bearer ${key}`;
  }

  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      redirect: 'error',
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return UNAVAILABLE;
    if (!response.ok) {
      if (options.kind === 'hermes' && response.status === 503) {
        const parsed = z.object({ error: z.string() }).safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.error === 'MODEL_AUTH_REQUIRED')
          return { models: [], state: 'auth_required' };
      }
      return UNAVAILABLE;
    }
    const body: unknown = JSON.parse(raw);
    const ids =
      options.kind === 'hermes' ? BridgeModels.parse(body).models : OpenAiModels.parse(body).data;
    return { models: cap(ids), state: 'ok' };
  } catch {
    return UNAVAILABLE;
  }
}
