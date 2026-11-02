import { z } from 'zod';

import { paginated } from '../common/pagination.js';
import { ApiKeyScope } from '../workspace/access.schema.js';
import { PublicEventType } from './public-events.js';

// ─── API keys (ADR-022 §2–3) ──────────────────────────────────────────────────

/** `rpz_live_<12-char id>_<32-char secret>`. */
export const API_KEY_PREFIX = 'rpz_live_';
export const API_KEY_PATTERN = /^rpz_live_([A-Za-z0-9]{12})_([A-Za-z0-9]{32})$/;

export const ApiKeyStatus = z.enum(['active', 'expired', 'revoked']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatus>;

export const ApiKeyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  /** `rpz_live_<keyId>_…`: enough to recognise a key, useless to call with. */
  prefix: z.string(),
  scopes: z.array(ApiKeyScope),
  status: ApiKeyStatus,
  createdBy: z.object({ userId: z.uuid(), name: z.string() }),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiKeyDto = z.infer<typeof ApiKeyDto>;

export const ApiKeyList = z.object({ data: z.array(ApiKeyDto) });
export type ApiKeyList = z.infer<typeof ApiKeyList>;

export const CreateApiKeyRequest = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ApiKeyScope).min(1),
  /** Optional expiry, in the future. */
  expiresAt: z.iso.datetime().nullable().default(null),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

/** The only response that contains the full key: it is never shown again. */
export const CreatedApiKey = z.object({ apiKey: ApiKeyDto, key: z.string() });
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

// ─── Webhook endpoints (ADR-022 §5–6) ─────────────────────────────────────────

/** HTTPS only; the SSRF guard (private ranges, ports) runs on the server at save and send time. */
export const WebhookUrl = z.url({ protocol: /^https$/ }).max(2048);

export const WebhookEndpointDto = z.object({
  id: z.uuid(),
  url: z.string(),
  description: z.string(),
  events: z.array(PublicEventType),
  enabled: z.boolean(),
  disabledReason: z.enum(['failing', 'manual']).nullable(),
  failingSince: z.iso.datetime().nullable(),
  /** The previous secret still signs until then, after a rotation. */
  previousSecretExpiresAt: z.iso.datetime().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WebhookEndpointDto = z.infer<typeof WebhookEndpointDto>;

export const WebhookEndpointList = z.object({ data: z.array(WebhookEndpointDto) });
export type WebhookEndpointList = z.infer<typeof WebhookEndpointList>;

export const CreateWebhookEndpointRequest = z.object({
  url: WebhookUrl,
  description: z.string().trim().max(200).default(''),
  events: z.array(PublicEventType).min(1),
});
export type CreateWebhookEndpointRequest = z.infer<typeof CreateWebhookEndpointRequest>;

/** Endpoint and its signing secret (`whsec_…`): returned on create and on rotation only. */
export const WebhookEndpointWithSecret = z.object({
  endpoint: WebhookEndpointDto,
  secret: z.string(),
});
export type WebhookEndpointWithSecret = z.infer<typeof WebhookEndpointWithSecret>;

/** Partial update; `enabled: true` re-enables an endpoint disabled for failing. */
export const UpdateWebhookEndpointRequest = z.object({
  version: z.number().int().positive(),
  url: WebhookUrl.optional(),
  description: z.string().trim().max(200).optional(),
  events: z.array(PublicEventType).min(1).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWebhookEndpointRequest = z.infer<typeof UpdateWebhookEndpointRequest>;

// ─── Deliveries ───────────────────────────────────────────────────────────────

export const WebhookDeliveryStatus = z.enum(['pending', 'succeeded', 'failed']);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>;

export const WebhookDeliveryDto = z.object({
  id: z.uuid(),
  endpointId: z.uuid(),
  eventId: z.uuid(),
  eventType: z.string(),
  status: WebhookDeliveryStatus,
  attempts: z.number().int(),
  nextAttemptAt: z.iso.datetime().nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** The envelope as sent. */
  payload: z.record(z.string(), z.unknown()),
});
export type WebhookDeliveryDto = z.infer<typeof WebhookDeliveryDto>;

export const WebhookDeliveryPage = paginated(WebhookDeliveryDto);
export type WebhookDeliveryPage = z.infer<typeof WebhookDeliveryPage>;

export const WebhookDeliveryQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: WebhookDeliveryStatus.optional(),
});
export type WebhookDeliveryQuery = z.infer<typeof WebhookDeliveryQuery>;
