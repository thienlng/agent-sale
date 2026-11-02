/** Result of one POST to a receiver. */
export type PostResult =
  { ok: true; status: number } | { ok: false; status: number | null; error: string };

/**
 * Outbound HTTPS to tenant-chosen URLs (ADR-022 §5–6). Every implementation applies the SSRF
 * guard: `check` at save time, and again inside `post` (DNS can change between the two).
 */
export interface WebhookTransport {
  /** Null when the URL may receive webhooks, else the rule it breaks. */
  check(url: string): Promise<string | null>;
  /** POSTs `body`; 2xx is ok. Never follows redirects; bounded time and response size. */
  post(url: string, headers: Record<string, string>, body: string): Promise<PostResult>;
}
export const WEBHOOK_TRANSPORT = Symbol('WEBHOOK_TRANSPORT');

/** The workspace's plan includes the public API (`feature.public_api`). */
export interface DeveloperPlanGate {
  enabled(workspaceId: string): Promise<boolean>;
}
export const DEVELOPER_PLAN_GATE = Symbol('DEVELOPER_PLAN_GATE');
