# 09 — Security, authorization & compliance

> References for Preny's weaknesses/open questions: `03-kien-truc-cong-nghe/06-bao-mat-va-quyen-rieng-tu.md`, `08-dashboard-thuc-te/08-quan-tri-va-bao-mat.md`.
> The legal content here is a **to-do checklist** and does not replace advice from a lawyer.

## 1. Goals

The product processes end-customer messages (containing phone numbers, addresses, images, sometimes ID documents) for thousands of businesses → **cross-tenant data leakage is the most severe incident**. Priorities: tenant isolation > channel token protection > control over sensitive operations > audit.

## 2. Authentication

- Sign-up: full name, email, phone number, password (as in Preny) → email verification (OTP/link); **phone number verification via OTP** (Zalo ZNS OTP or SMS) before using campaign-sending features (Preny also gates email campaigns behind phone number verification — anti-spam).
- **Implemented (ADR-023):** the signup page asks for name, email and password; "Send code" emails a 6-digit code through Resend (`noreply@rapiz.io`) and the account is created only with that code, so every user has a verified email. The code is stored as a sha256, lives 15 minutes, allows 5 wrong tries and can be resent every 60 s. The business comes next, in onboarding (`POST /auth/signup/business`, which also starts the trial). Forgot password: an emailed code sets a new password and revokes every session. Phone OTP is not built yet.
- Passwords: Argon2id; minimum length policy ≥ 8; optional breach check (HIBP k-anonymity).
- **Google sign-in (implemented, ADR-007):** "Continue with Google" on the login and signup pages. Server-side authorization code flow with PKCE (S256), `state` and `nonce`; the flow lives in a sealed (AES-GCM, `SECRETS_ENCRYPTION_KEY`), HttpOnly, `SameSite=Lax` cookie scoped to `/api/v1/auth/google` for 10 minutes. The ID token is verified against Google's published keys (issuer, audience = our client id, expiry, RS256) and must carry `email_verified`. The Google account is stored by its stable `sub` (`user_identities`) and linked on first use to the user with the same email, or creates a password-less, verified user who then creates the first business in onboarding. Linking to an address that was never verified drops that account's password and revokes its sessions (pre-registration takeover). Users with TOTP still enter a code (a sealed 5-minute pending cookie, `POST /auth/google/mfa`). The SPA never sees a Google token: the callback sets the refresh cookie and redirects to `/login?google=done`.
- TOTP 2FA (+ recovery codes) — implemented (T-057, ADM-04): see `apps/backend/src/modules/identity/MODULE.md`. 2FA required for the Owner on paid plans is still a recommendation, not enforced. Turning 2FA on or off, or regenerating recovery codes, revokes every other refresh-token family of the user (T-064), so a session stolen before the change does not outlive it.
- Tokens: 15-minute access JWT (signed with EdDSA/RS256, with `kid` for rotation), opaque refresh token stored hashed in the DB, **rotation + reuse detection** → revoke the whole chain.
- **Where tokens live (SPA):** the access token only in memory (never `localStorage`/`sessionStorage`); the refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `api.<domain>/api/v1/auth/refresh`, with an `Origin` check on that endpoint. On boot the SPA calls `/auth/refresh` (cookie) then `/bootstrap` (session + workspace + entitlements + flags) before first paint. Native/mobile clients send `client=native` and receive the refresh token in the response body (secure storage on device). Strict CSP (no `unsafe-inline`), sanitized rendering of all message content and attachments. Bearer tokens are used for every API call by every client, so SSE/WebSocket/mobile share one auth path (RFC 10017 ranks a BFF/session cookie first; this hybrid keeps the long-lived credential out of JavaScript while preserving API parity).
- Session management: device list, remote logout, log out everywhere on password change.
- Rate limiting + progressive lockout for login/OTP; captcha when suspicious.
- Enterprise (P3): SSO SAML/OIDC, SCIM.

## 3. Authorization (RBAC + data scope)

Default roles (custom roles can be created on Pro+ plans):

| Permission \ Role | Owner | Admin | Sales manager | Sales | Bot configurator | Accountant |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View/reply to conversations | All | All | All | **Assigned only** / by page | — | — |
| Turn the bot on/off in a conversation | ✓ | ✓ | ✓ | ✓ (own) | — | — |
| Configure bot, knowledge | ✓ | ✓ | — | — | ✓ | — |
| Connect/disconnect channels | ✓ | ✓ | — | — | — | — |
| View CRM | All | All | All | Assigned contacts | — | — |
| **Export CRM** | ✓ | ✓ | optional | ✗ | ✗ | ✗ |
| Delete contacts / merge contacts | ✓ | ✓ | ✓ | ✗ | — | — |

Built so far (T-044 roles): deleting a customer is the `contacts.delete` capability of the owner and admin roles (the role set has no separate sales manager yet); it is never an API-key scope and the owner assistant never calls it. Merging is not built.
| Create/edit orders | ✓ | ✓ | ✓ | ✓ | — | view |
| Edit order prices / discounts above threshold | ✓ | ✓ | ✓ | configurable | — | — |
| Create/run campaigns (costs money) | ✓ | ✓ | optional | ✗ | — | — |
| Top up, buy plans, view invoices | ✓ | — | — | — | — | ✓ |
| Manage members & permissions | ✓ | ✓ (except Owner) | — | — | — | — |
| View audit log | ✓ | ✓ | — | — | — | — |

- Permissions are permission strings (`conversation.reply`, `crm.export`, `campaign.send`, `billing.pay`…); a role = a set of permissions.
- Combined **data scope**: by assigned channel/page, by assigned contact.
- **Contact distribution rules** (as in Preny): by page, by ratio (weighted round-robin), by day/shift; distribute only to staff currently online (optional); returning contacts → go back to their previous salesperson.
- Enforcement on the **server**: NestJS guards check membership (from the token; do not trust the `X-Workspace-Id` header if the user does not belong to the workspace) + permission + scope; Postgres RLS is the second layer.

## 4. Tenant isolation

- Every query goes through a repository that requires `workspace_id` (lint rule + tests).
- RLS policy `USING (workspace_id = current_setting('app.workspace_id')::uuid)` on all business tables; the app's DB role does **not** have `BYPASSRLS`; workers set the context per job.
- Public IDs are UUIDv7 / ULID — no sequential IDs that reveal scale.
- Object storage: keys prefixed `ws/{workspace_id}/…`, accessed via **short-lived signed URLs**; private buckets.
- Automated "cross-tenant" tests: for every endpoint, a user in workspace A calling a resource in workspace B → must get 404.

### Owner assistant SQL lane (T-171)

The owner assistant answers number questions with one model-written `SELECT` over the read-only `assistant_sql` views ([spec](superpowers/specs/2026-11-02-owner-assistant-data-questions-design.md) §3, ADR-004 amendment T-171). Each defence holds even if the others fail:

| Threat | Defence |
|---|---|
| Writes (`DELETE`, `UPDATE`, DDL, `SELECT … INTO`, `FOR UPDATE`) | The SQL guard allows one `SELECT`/`WITH`; the login has no write grant; the transaction is `READ ONLY` and the login defaults to `default_transaction_read_only`; the view owner has no write grant |
| Another account's or business's rows | The view owner's own `FOR SELECT` policies keep only the businesses in `app.assistant_business_ids` that belong to `app.account_id`; both are set transaction-locally from the owner scope and read back before the query runs |
| Forged GUCs, `SET ROLE` | `SET`/`RESET` and `set_config`/`current_setting` are rejected by the guard; a forged list needs the other account's id and business ids together; the lane has its own login (member of `app_assistant_sql` only), so there is no role to switch back to |
| Base tables, secrets, PII, catalogs | `SELECT` on the views only; column-level grants for the view owner leave the PII columns out; the guard rejects `pg_*`, `information_schema`, `public.`, quoted identifiers and comments; `search_path = assistant_sql` |
| Functions with side effects, sleeps, catalog casts | Function and cast allow-lists in the guard; typed literals only for date and time types |
| Load on the primary | 3 s statement timeout, 1 s lock timeout, 5 s idle-in-transaction timeout, 16 MB `work_mem`, at most 501 rows by cursor, pool 4, 8 queries per turn |
| Memory blow-up from one query (strings grown through chained CTEs, long cross joins) | The guard allows no string-building operator or function (`\|\|`, `concat`, `replace`, `repeat`, `lpad`, `string_agg`, …), caps string literals at 200 chars, CTEs at 10, FROM items at 6 per query (comma-joined ones included) and `generate_series` at 1 call; the login has `work_mem = 16MB` and `temp_file_limit = 256MB` (superuser-only, read back before every query). `work_mem` limits each sort, hash or materialize node of the plan, not the whole query, and Postgres has no per-backend memory cap, so what bounds memory is the guard's structural caps plus the 3 s timeout |
| Reading another session's query text in `pg_stat_activity` | The login has `track_activities = off` (superuser-only, read back before every query), so no assistant session publishes its query text; the guard also rejects `pg_*` |
| Prompt injection through data | Results are tool output; `<` is escaped and cells are cut to 200 chars |
| Query text or rows in logs | Logs carry the run id, error code, SQL state and a hash fingerprint only; no SQL or rows in logs or run steps |
| Multi-statement smuggling | The guard rejects `;`; the driver uses the extended protocol |

**PII exclusion list** (never in a view, never granted to the view owner): phone, email, address, birthday and gender of customers and recipients; `orders.recipient`; free-text notes (`note_internal`, `profile_note`, `note`); conversation and message text and `data` documents; `customer_phone` and the platform `customer_id`; sealed tokens, settings and external ids; staff names and user ids; anything billing, identity, assistant or audit. Names of customers, guests, products, bots, channels and businesses are allowed; `customers.has_phone` is a boolean.

**Known gap:** the login can read the `PUBLIC` system catalog, including `pg_stat_activity` (pid, state and timing, but no query text, because of `track_activities = off`). `PUBLIC`-executable built-ins (`query_to_xml`, `set_config`) are also blocked by the guard only; at the database level they run as the login and are bounded by its grants.

## 5. Secrets & channel tokens

- Meta/Zalo/TikTok/carrier tokens: **envelope encryption** (AES-256-GCM data key, master key in KMS/Vault); never logged; only connectors can read them.
- Application secrets in Vault/KMS/Secret Manager, never in the repo or committed env files.
- Secrets that admins enter in the product (LLM provider API keys today, channel tokens later) are sealed with AES-256-GCM (`SecretBox`, `v1.` format leaves room for key rotation) using `SECRETS_ENCRYPTION_KEY`, which lives outside the database; required in production. APIs never return them — only a 4-character hint.
- Shop-declared API actions (T-055): the API key/Bearer secret is sealed with `SecretBox`, write-only (`hasSecret`), never sent to the model or written to logs/`action_runs`. Outbound calls go through an SSRF-safe executor (public addresses only, pinned IP, no redirects, 8 s / 256 KB limits) — see [actions.md](actions.md).
- Owner assistant (T-174): keys an owner pastes into the assistant chat (headers, query/JSON keys, `-u user:pass`, `sk-…`, `Bearer …`, long mixed hex/base64 runs) are replaced by `[secret removed]` before the message is stored or sent to the model. A route body that can carry a secret becomes an assistant `write` only through a narrowed `assistant.body` that rejects it (contract test), so an assistant-drafted API action never holds its secret; the owner types it in the form.
- Platform admin (`users.is_platform_admin`) is granted only from the CLI (`pnpm --filter @agent-sales/backend platform-admin grant <email>`), checked against the database on every admin request, and admin routes answer 404 to everyone else.
- Webhooks: verify signatures 100% of the time; reject replays older than 5 minutes when a timestamp is present.

### Website chat widget (T-100)

- **Public, unauthenticated surface.** The site key (`wk_…`) is an identifier, not a secret. Access is gated by (1) the site being `connected`, (2) the browser `Origin` matching a configured domain (exact or subdomain; `Origin` is forgeable outside browsers, so it stops other sites from embedding a stolen key but is not an abuse control), (3) per-visitor, per-address and per-site rate limits. Unknown key, disabled site and wrong origin are indistinguishable (`404 NOT_FOUND`), so keys cannot be probed.
- **Visitor token.** `v1.<visitorId>.<base64url HMAC-SHA256(site secret, visitorId)>`; the per-site 32-byte secret is sealed with `SECRETS_ENCRYPTION_KEY`, cached opened in process (bounded) and never leaves the `channel` module. Verification is constant-time and needs no database read. The widget keeps it in `localStorage`; clearing storage starts a new visitor.
- **Client address.** Per-address limits read the request IP, which is only trustworthy because the API runs Fastify with `trustProxy: true` behind a proxy/load balancer that overwrites `X-Forwarded-For`; without such a proxy a caller could choose its own address. The in-memory limiter is per API instance (N replicas allow N times the limits) until the Redis adapter exists. Only a site lookup that misses the 5 s cache (a DB query) is charged to the address (300 per 10 minutes), so polling or config calls answered from the cache never starve visitors sharing one address.
- **No IP or user agent is stored.** Addresses are hashed with a per-process secret and a daily salt and used only as in-memory rate-limit keys.
- **Rate limits (deviation: in memory, not Redis).** `RATE_LIMITER` is a port with a fixed-window in-process implementation (bounded to 50 000 keys, periodic sweep). Limits: visitor 5 messages per 5 s and 60 per hour, 10 uploads per hour; address 300 uncached site lookups per 10 minutes (answered 429 without querying), and per site and address 120 messages and 2 400 polls per 10 minutes, 60 uploads per hour; site 120 new visitors per minute. With several API replicas the effective limit is per replica; swap in a Redis adapter behind the port when the API scales out. Exceeded: `429` + `Retry-After`.
- **CORS.** The caller's own origin is echoed on every public response (including the uniform 404, so the widget can read it and stop rendering), `Vary: Origin`, no credentials, never `*`. Preflight is answered only for an allowed origin of a live site. Dashboard routes are unchanged (no global CORS).
- **Uploads.** One image (`jpeg|png|webp|gif`; without a visitor token the upload starts the visitor like a first message, under the same new-visitor limits) judged by magic bytes only, at most 5 MB, stored as `webchat/<workspace>/<connection>/<uuid>.<ext>` in the public bucket (`S3_PUBLIC_URL`); no object storage means `503 UNAVAILABLE`. A message may only attach a URL under that visitor site's own prefix. The bot's image fetcher allows our upload host (https, no private addresses).
- **Visibility.** The visitor sees their messages and sent bot/staff messages only: never notes, failed or unknown messages, and staff appear under the site's agent name.

## 6. Application protection

- OWASP ASVS L2 as the checklist; SAST (Semgrep/CodeQL), dependency scanning (Dependabot/Renovate + `pnpm audit`), container scanning (Trivy), secret scanning (gitleaks) in CI.
- Strict CSP for the dashboard; the widget is a Shadow DOM script (ADR-011), and CORS works by the site-domain allowlist.
- Uploads: check the real MIME type, size limits (ticket images 2MB×5 as in Preny; imports 50MB), malware scanning (ClamAV) for document files, strip EXIF.
- SSRF protection for the knowledge URL crawling feature (block internal IPs, metadata endpoints).
- WAF + rate limiting at the edge; DDoS protection.
- Independent pentest before broad commercial launch and annually.

## 7. Audit log

`audit_events (id, workspace_id, actor_user_id, actor_name, action, target_type, target_id, data JSONB, created_at)` (built, T-054; `data` holds `{ field: { from, to } }` and context. `ip`, `user_agent` and account-level events such as 2FA changes are not recorded yet) — append-only (no UPDATE/DELETE privileges for either application role, `app_tenant` or `app_system`; migration 0020), retained ≥ 1 year.

Mandatory events: login/2FA, permission changes/inviting/removing members, connecting/disconnecting channels, editing bot configuration, data export, deleting/merging contacts, editing order prices, creating/sending campaigns, manual wallet top-ups/deductions, admin impersonation.

## 8. AI & personal data

- Send to the LLM only the data needed for the answer; mask national ID numbers/card numbers/passwords if detected.
- Choose providers/endpoints that **do not use data for training**, with a DPA; publish the list of sub-processors.
- Never use tenant A's conversation data to improve tenant B's bot.
- Shop-bot turn traces (T-174, `ai_run_traces` / `ai_run_steps`): forced RLS per workspace, readable only with `bots.manage`, deleted after **30 days**. The customer and reply excerpts (≤ 300 chars) are redacted (phones, e-mails, URLs and secrets replaced); step details are allowlisted ids, counts and codes, never tool arguments, action responses, recipient or guest names, phones or addresses. Logs carry the run id and error class only.
- State clearly in the policy: where data is processed (Vietnam / abroad), and retention periods.
- **Do not advertise "end-to-end encryption (E2EE)"** as Preny does — server-side AI must read the content; say it accurately: encryption in transit (TLS) and at rest.

## 9. Vietnamese legal compliance (checklist for lawyer review)

| Regulation | What needs to be done |
|---|---|
| Personal Data Protection Law (Luật Bảo vệ dữ liệu cá nhân) (effective 01/01/2026) and Decree 13/2023/ND-CP | Determine roles: we are the **processor** of end-customer data on behalf of the shop (the controller) and the **controller** of shop account data. Contract/DPA with shops; data processing impact assessment dossier; cross-border data transfer dossier (when calling foreign LLMs); breach notification procedure; access/deletion request procedure |
| Regulations against spam messages and spam email (Decree 91/2020/ND-CP on anti-spam and amending documents) | Campaigns must have opt-in/opt-out, frequency limits, sending time windows, content identifying the sender |
| Law on Electronic Transactions (Luật Giao dịch điện tử), Decree 123/2020/ND-CP on invoices | E-invoices for subscriptions/credit |
| E-commerce | Register/notify the e-commerce website if applicable; clear terms of service, payment policy, refund policy |
| Platform policies (Meta, Zalo, TikTok) | Privacy policy URL, data deletion callback (Meta — built: [07 §3](07-channel-integrations.md#data-deletion-callback-built)), comply with messaging policies to avoid having the app blocked — **the biggest business risk** |

Preny has weak legal documentation (policies dated before the company's founding date, terms still containing placeholders) → we do it cleanly from the start: ToS, Privacy, DPA, Acceptable Use, SLA, versioned, with a stored acceptance history for each workspace.

## 10. Data subject rights & data lifecycle

- Export all workspace data (CSV/JSON) — prevents lock-in, and is also a selling point. Built (SET-10): capability `data.export` (owner and admin, never an API-key scope); the ZIP lives in a private bucket (`S3_EXPORT_BUCKET`), never the public media bucket, for 7 days; downloads go through a one-time link (32 random bytes, SHA-256 at rest, 5 minutes, one use, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`); text that a spreadsheet would run as a formula is prefixed with `'`; secrets, tokens and key material are never exported; audit events `workspace.data_exported` and `workspace.data_export_downloaded`.
- Delete end customers on request: delete/anonymize profile + messages + media; record audit; backups expire automatically on a schedule (stated clearly in the policy). **Built** (`DELETE /contacts/{id}`, CRM-17; notes alone: `DELETE /contacts/{id}/notes/{noteId}`):
  - Coordination: crm's `ContactLifecycle` (`modules/crm/api/contact-lifecycle.ts`). Modules above crm register steps in three phases — `collect` (conversation: the customer's conversation ids), `detach` (commerce, lodging, webchat, ai) and `erase` (conversation) — and crm deletes the customer last, in one transaction with the audit event and the outbox event. Every step is idempotent; a failure leaves the customer in place and the delete is simply retried. No module reads another's tables.
  - Deleted: the contact row, its notes, history, contact tag assignments, tasks (and customer-less tasks of its conversations), `contact_bots` and SaaS subscriptions (foreign keys); the conversations with every message, their tag assignments, Brain signals and jobs and care enrollments/messages (foreign keys), the AI summaries of those conversations, pending bot order and hold drafts, the website-chat visitor rows, the processed raw channel events (`channel_webhook_events`) of those customers, and the pictures the customer uploaded through website chat (`webchat/<workspace>/…` in the public bucket; product pictures and Meta CDN links are not ours to delete).
  - Kept, anonymized: orders of the customer's conversations, and orders whose customer phone is the customer's (digits compared, `0…`/`84…` alike) **and** whose customer name is the customer's (trimmed, spaces collapsed, case-insensitive) or empty, keep only `customer.name = "Khách đã xoá"` (`DELETED_CUSTOMER_NAME`); the recipient is anonymized too when it is the same person (same phone or name, or no phone), a gift recipient stays; the search text is rebuilt. Stay bookings linked by customer or conversation, or with the customer's phone and the customer's name (or no name) as guest, get the same guest name, an empty phone and no customer link (blocks untouched). Orders and bookings carry no customer id, so the phone is the only link for staff-typed ones: the name condition keeps the order or booking of another person who shares the phone (a family, a front desk) under their own name; a staff-typed record of that other person **without** a name is still anonymized, and one of the deleted customer typed under a different name (a nickname) is not — staff check those by hand.
  - Known gap: the conversation ids are collected first and the customer is deleted last; a conversation that arrives from the same person in between (a new thread, not a message to a collected one) is not erased and survives unlinked from any customer (its `contact_id` is cleared with the customer). Staff delete it from the inbox; a second `DELETE /contacts/{id}` cannot reach it because the customer is gone.
  - Kept as they are: aggregate statistics (`analytics_facts` hold ids only), metering rows (`ai_runs`, `action_runs`, `signal_runs`, `message_usage`, no text), redacted bot turn traces (expire after 30 days), outbox events (ids only) and the short-lived `action_pending` arguments (minutes). Not handled: a Rapiz HQ link (`saas_hq_links`) to a deleted customer stays until the next HQ reconcile; Facebook comments the person wrote on the Page stay in `fanpage_comments` (public content of the Page).
  - Audit `contact.deleted` (ids and counts only, never the name or phone), event `crm.contact.deleted.v1` `{ workspaceId, contactId, actorUserId, occurredAt }`, public webhook type `crm.contact.deleted`. A new message from the same person later creates a new customer.
- Workspace deletion: 30-day soft delete → hard delete + delete object storage + revoke channel tokens. Built (SET-10, [ADR-032](adr/ADR-032-business-deletion-soft-delete-restore-purge.md)): owner only, the business name typed exactly; at once the business is `pending_deletion`, hidden from every list, closed to every member (404), entitled to nothing (no bot reply, care message, Brain evaluation or webhook), its Facebook/Instagram pages removed (sealed tokens wiped, Meta webhooks unsubscribed), website chats off and KiotViet disconnected; restorable for 30 days (channels stay disconnected; the window is decided on the database clock and a restore can never win once the purge claimed the business, status `purging`); then the worker re-runs the channel and KiotViet disconnection (in case it failed the first time) and deletes every row with its `workspace_id` (catalog-derived), its media (`products/`, `workspaces/`, `webchat/`, `lodging/` prefixes) and export archives. Kept: the audit trail (`audit_events`, ≥ 1 year), the account's usage counts (`message_usage`, ids only) and a tombstone `workspaces` row with the name and profile erased. Audit events `workspace.deletion_requested`, `workspace.restored`, `workspace.purged`. Backups still hold the data until they expire (ADR-028).
- Default retention (configurable per plan): messages 24 months; raw webhooks 30 days; technical logs 30 days; ai_runs prompt details 90 days (metrics kept longer).

## 11. Certification goals

Year 1: prepare according to ISO/IEC 27001 (policies, risk register, access management, backup testing). Once there are Enterprise customers: ISO 27001 audit; SOC 2 if selling internationally.
