/**
 * The closed list of plan entitlement keys (docs/08 §3). The plan editor in /admin is generated from
 * it and rejects unknown keys. Kinds:
 * - `limit`: integer, `null` = unlimited;
 * - `flag`: boolean feature switch;
 * - `models`: allowed AI model tiers;
 * - `allowance`: `{ amount, periodDays }` AI replies per cycle.
 */
export const ENTITLEMENT_KEYS = {
  'members.max': 'limit',
  'channels.max': 'limit',
  'contacts.max': 'limit',
  'storage.bytes': 'limit',
  'media.max': 'limit',
  'knowledge_items.max': 'limit',
  'ai.models.allowed': 'models',
  'ai.included_messages': 'allowance',
  'feature.website_widget': 'flag',
  'feature.lazada': 'flag',
  'feature.facebook_posts': 'flag',
  /** Public API keys and webhooks (ADR-022). */
  'feature.public_api': 'flag',
  /** Requests per minute per API key. */
  'api.requests_per_minute': 'limit',
  /** Business Brain conversation evaluations per business per day (Asia/Ho_Chi_Minh). */
  'brain.evaluations.daily': 'limit',
  /** Care agent messages per business per day (Asia/Ho_Chi_Minh). */
  'care.messages.daily': 'limit',
} as const;
export type EntitlementKey = keyof typeof ENTITLEMENT_KEYS;
export type EntitlementKind = (typeof ENTITLEMENT_KEYS)[EntitlementKey];

export const AI_MODEL_TIERS = ['smart', 'pro', 'neo'] as const;

/** Billing periods in months that a plan may price. */
export const BILLING_PERIODS = [1, 3, 6, 12] as const;
