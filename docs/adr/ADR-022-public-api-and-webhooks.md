# ADR-022: Public API keys and signed webhooks on the existing `/api/v1` (VRT-10)

- Status: Proposed
- Date: 2026-11-02
- Decision makers: thienlng
- Requirement: VRT-10 (docs/02) · related: ADR-021 §7

## Context

Tenants want their own systems (ERP, POS, PMS, LMS, n8n/Make/Zapier, a custom CRM) to read and write
their Rapiz data and to be told when something changes. Today the only clients are our own SPA (user
sessions, `Authorization: Bearer <JWT>` + `X-Workspace-Id`) and our own connectors (KiotViet, inside
`integration`). Integration events already exist in `outbox_events` (crm, lodging, account, billing),
and route contracts in `packages/contracts` already generate an OpenAPI document.

## Decision

1. **One API, not a second one.** Public clients call the same `/api/v1` routes as the SPA. A route is
   reachable with an API key only when its contract says `apiKey: true`; every other route answers
   404 to an API key. The public OpenAPI document (`GET /api/v1/public/openapi.json`) lists only those
   routes, with the `ApiKey` security scheme.
2. **Workspace API keys.** Created by members with the new capability `developer.manage` (owner and
   admin). Format `rpz_live_<12-char id>_<32-char secret>`; only the SHA-256 of the secret is stored;
   the full key is shown once. A key has a name, **scopes**, an optional expiry, `last_used_at`, and
   can be revoked. Sent as `Authorization: Bearer rpz_live_…`; the workspace comes from the key
   (`X-Workspace-Id` optional, must match when present).
3. **Scopes are capabilities.** A scope is one of the existing capabilities (`contacts.view`,
   `contacts.edit`, `orders.view`, `orders.manage`, `catalog.manage`, …) minus member, settings,
   developer and audit management. A request runs **on behalf of the key's creator** with the
   capabilities `scopes ∩ creator's role`; if the creator leaves the workspace or loses the role, the
   key stops working. Audit rows name the actor `API: <key name>`. `contacts.view_all` is a scope like
   any other (without it a key sees only the creator's customers, same rule as the SPA).
4. **Plan gate and limits.** New entitlement keys: `feature.public_api` (flag) and
   `api.requests_per_minute` (limit). Seed: Pro and Neo on (120/min), Free and Smart off; operators
   grant overrides in `/admin`. Rate limiting is per key in a fixed 60 s window shared by every API
   process (a counter on the key's row in Postgres: the guard already reads the key there; Redis
   is not wired into the backend yet and can replace it behind the same port) with `429`,
   `Retry-After` and `X-RateLimit-*` headers. Write routes accept `Idempotency-Key` (24 h replay of
   the first response, per key).
5. **Webhooks.** Workspace endpoints (HTTPS only), each with a subscribed event list and a signing
   secret (`whsec_…`, encrypted with `SecretBox`, rotatable with a 24 h overlap). Delivery is a POST
   with a stable JSON envelope `{ id, type, workspaceId, occurredAt, data }` and headers
   `Rapiz-Event-Id`, `Rapiz-Event-Type`, `Rapiz-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret,
   "<t>.<body>")>`. A dispatcher in the worker reads `outbox_events` by transaction horizon (same
   pattern as the analytics projector and the HQ sync), keeps **only public event types** of the
   endpoint's workspace, and writes `webhook_deliveries`. A sender posts with a 10 s timeout and
   retries with backoff (1 m, 5 m, 30 m, 2 h, 6 h, 12 h, 24 h); after the last failure the delivery is
   `failed`, and an endpoint failing for 3 days is disabled and the owner is notified. Owners see
   the delivery log, resend one delivery and send a test event. Receivers must dedupe by event id
   (at-least-once).
6. **SSRF guard.** Endpoint URLs must be `https`, on port 443 or ≥ 1024, and must not resolve to
   loopback, private, link-local, CGNAT, multicast or cloud metadata ranges, checked at save time
   **and** at every delivery (DNS rebinding). No redirects are followed.
7. **Public event catalog.** Only events listed in `PUBLIC_EVENT_TYPES` leave the platform, mapped by
   a per-type function to a stable `data` payload (never internal ids of other workspaces, never
   secrets). v1: `crm.contact.created|updated|status_changed|assigned`, `crm.tag.assigned|removed`,
   `lodging.booking.*`, `commerce.order.created|status_changed`, `saas.subscription.changed`.
   Platform events (`account.*`, `billing.*`) are never public.
8. **Modules.** API keys are credentials, so **`identity`** owns `api_keys` (like sessions) and the
   `AuthGuard` verifies them directly. A new tier-3 module **`developer`** owns `webhook_endpoints`
   and `webhook_deliveries` (tenant tables with RLS), the dispatcher and sender, the public event
   catalog mapping, and the HTTP surface of Settings → Developers (keys through the `identity`
   facade).

## Options considered

1. **A separate `/public/v1` API with its own DTOs**: rejected for now; it doubles the contract
   surface. Marking routes keeps one source of truth; a route that must differ gets a new versioned
   path later.
2. **OAuth 2 apps (client credentials / authorization code)**: deferred. Needed for a marketplace of
   third-party apps; API keys cover a tenant's own systems, which is VRT-10.
3. **Store keys encrypted instead of hashed**: rejected; we never need the key back.
4. **Send every outbox event**: rejected; internal events change freely, public ones are a contract.

## Consequences

- Route contracts gain `apiKey?: boolean`; the backend contract test checks that API-key routes are
  workspace-scoped and capability-guarded.
- Public event payloads are versioned contracts: a breaking change needs `.v2` and both versions
  delivered during a deprecation window.
- `commerce` and `saas` start publishing order and subscription events.
- New load on the worker (dispatcher + sender); deliveries are partitioned by endpoint so one slow
  receiver does not block others.
