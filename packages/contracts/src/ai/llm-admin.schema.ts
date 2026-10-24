import { z } from 'zod';

import { ModelTier } from '../bot/bot.schema.js';

export const LlmProviderKind = z.enum(['anthropic', 'openai_compatible', 'hermes']);
export type LlmProviderKind = z.infer<typeof LlmProviderKind>;

export const LlmEffort = z.enum(['low', 'medium', 'high']);
export type LlmEffort = z.infer<typeof LlmEffort>;

/** Provider-specific knobs. Only meaningful for `openai_compatible`. */
export const LlmProviderOptions = z.object({
  /** How the server supports JSON output: json_schema (vLLM, SGLang, Ollama ≥ 0.5, OpenAI), json_object, none. */
  structuredOutput: z.enum(['json_schema', 'json_object', 'none']).default('json_schema'),
  /** Forward the tier's effort as `reasoning_effort` (reasoning models only). */
  sendReasoningEffort: z.boolean().default(false),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
});
export type LlmProviderOptions = z.infer<typeof LlmProviderOptions>;

/** The API key is write-only: responses carry only whether one is set and its last 4 characters. */
export const LlmProviderDto = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: LlmProviderKind,
  baseUrl: z.string().nullable(),
  hasApiKey: z.boolean(),
  apiKeyHint: z.string().nullable(),
  options: LlmProviderOptions,
  isEnabled: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type LlmProviderDto = z.infer<typeof LlmProviderDto>;

const ProviderName = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, 'lowercase letters, digits and dashes, 2–40 characters');
const BaseUrl = z.url({ protocol: /^https?$/ }).max(500);

export const CreateLlmProviderRequest = z
  .object({
    name: ProviderName,
    kind: LlmProviderKind,
    baseUrl: BaseUrl.optional(),
    apiKey: z.string().trim().min(1).max(500).optional(),
    options: LlmProviderOptions.partial().optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine((p) => !['openai_compatible', 'hermes'].includes(p.kind) || !!p.baseUrl, {
    message: 'baseUrl is required for openai_compatible and hermes providers',
    path: ['baseUrl'],
  })
  .refine((p) => p.kind !== 'hermes' || (p.apiKey?.length ?? 0) >= 32, {
    message: 'Hermes requires a private bridge key of at least 32 characters',
    path: ['apiKey'],
  });
export type CreateLlmProviderRequest = z.infer<typeof CreateLlmProviderRequest>;

/**
 * `apiKey: null` removes the stored key; omitted keeps it — unless `baseUrl` changes,
 * which drops the stored key (it is never sent to a new host). `baseUrl: null` clears it.
 */
export const UpdateLlmProviderRequest = z.object({
  baseUrl: BaseUrl.nullable().optional(),
  apiKey: z.string().trim().min(1).max(500).nullable().optional(),
  options: LlmProviderOptions.partial().optional(),
  isEnabled: z.boolean().optional(),
});
export type UpdateLlmProviderRequest = z.infer<typeof UpdateLlmProviderRequest>;

export const LlmProviderList = z.object({ data: z.array(LlmProviderDto) });

export const LlmModelTarget = z.object({
  providerId: z.uuid(),
  model: z.string().trim().min(1).max(200),
  effort: LlmEffort.nullable(),
});
export type LlmModelTarget = z.infer<typeof LlmModelTarget>;

export const LlmTierRouteDto = z.object({
  tier: ModelTier,
  primary: LlmModelTarget,
  /** Used when the primary provider fails (errors, timeouts). */
  fallback: LlmModelTarget.nullable(),
  updatedAt: z.iso.datetime(),
});
export type LlmTierRouteDto = z.infer<typeof LlmTierRouteDto>;

/** Tiers without a route cannot answer (503) in production. */
export const LlmTierRouteList = z.object({ data: z.array(LlmTierRouteDto) });

export const PutLlmTierRouteRequest = z.object({
  primary: LlmModelTarget,
  fallback: LlmModelTarget.nullable(),
});
export type PutLlmTierRouteRequest = z.infer<typeof PutLlmTierRouteRequest>;

export const TestLlmProviderRequest = z.object({ model: z.string().trim().min(1).max(200) });
export type TestLlmProviderRequest = z.infer<typeof TestLlmProviderRequest>;

export const TestLlmProviderResponse = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int(),
  model: z.string().nullable(),
  /** Provider error message when `ok` is false (never contains the API key). */
  error: z.string().nullable(),
});
export type TestLlmProviderResponse = z.infer<typeof TestLlmProviderResponse>;

/** ChatGPT sign-in state of a Hermes runtime. `unreachable` = the bridge did not answer. */
export const HermesLoginStatus = z.object({
  state: z.enum(['signed_out', 'pending', 'signed_in', 'failed', 'unreachable']),
  verificationUrl: z.string().optional(),
  userCode: z.string().optional(),
  expiresAt: z.string().optional(),
  /** Machine reason when `failed`, e.g. device_code_timeout, rate_limited, login_failed. */
  code: z.string().optional(),
});
export type HermesLoginStatus = z.infer<typeof HermesLoginStatus>;
