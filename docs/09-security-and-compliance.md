# 09 — Security, authorization & compliance

> References for Preny's weaknesses/open questions: `03-kien-truc-cong-nghe/06-bao-mat-va-quyen-rieng-tu.md`, `08-dashboard-thuc-te/08-quan-tri-va-bao-mat.md`.
> The legal content here is a **to-do checklist** and does not replace advice from a lawyer.

## 1. Goals

The product processes end-customer messages (containing phone numbers, addresses, images, sometimes ID documents) for thousands of businesses → **cross-tenant data leakage is the most severe incident**. Priorities: tenant isolation > channel token protection > control over sensitive operations > audit.

## 2. Authentication

- Sign-up: full name, email, phone number, password (as in Preny) → email verification (OTP/link); **phone number verification via OTP** (Zalo ZNS OTP or SMS) before using campaign-sending features (Preny also gates email campaigns behind phone number verification — anti-spam).
- Passwords: Argon2id; minimum length policy ≥ 8; optional breach check (HIBP k-anonymity).
- Google OAuth login.
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

## 5. Secrets & channel tokens

- Meta/Zalo/TikTok/carrier tokens: **envelope encryption** (AES-256-GCM data key, master key in KMS/Vault); never logged; only connectors can read them.
- Application secrets in Vault/KMS/Secret Manager, never in the repo or committed env files.
- Secrets that admins enter in the product (LLM provider API keys today, channel tokens later) are sealed with AES-256-GCM (`SecretBox`, `v1.` format leaves room for key rotation) using `SECRETS_ENCRYPTION_KEY`, which lives outside the database; required in production. APIs never return them — only a 4-character hint.
- Shop-declared API actions (T-055): the API key/Bearer secret is sealed with `SecretBox`, write-only (`hasSecret`), never sent to the model or written to logs/`action_runs`. Outbound calls go through an SSRF-safe executor (public addresses only, pinned IP, no redirects, 8 s / 256 KB limits) — see [actions.md](actions.md).
- Platform admin (`users.is_platform_admin`) is granted only from the CLI (`pnpm --filter @agent-sales/backend platform-admin grant <email>`), checked against the database on every admin request, and admin routes answer 404 to everyone else.
- Webhooks: verify signatures 100% of the time; reject replays older than 5 minutes when a timestamp is present.

## 6. Application protection

- OWASP ASVS L2 as the checklist; SAST (Semgrep/CodeQL), dependency scanning (Dependabot/Renovate + `pnpm audit`), container scanning (Trivy), secret scanning (gitleaks) in CI.
- Strict CSP for the dashboard; widget runs in a sandboxed iframe; CORS by allowlist.
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
- State clearly in the policy: where data is processed (Vietnam / abroad), and retention periods.
- **Do not advertise "end-to-end encryption (E2EE)"** as Preny does — server-side AI must read the content; say it accurately: encryption in transit (TLS) and at rest.

## 9. Vietnamese legal compliance (checklist for lawyer review)

| Regulation | What needs to be done |
|---|---|
| Personal Data Protection Law (Luật Bảo vệ dữ liệu cá nhân) (effective 01/01/2026) and Decree 13/2023/ND-CP | Determine roles: we are the **processor** of end-customer data on behalf of the shop (the controller) and the **controller** of shop account data. Contract/DPA with shops; data processing impact assessment dossier; cross-border data transfer dossier (when calling foreign LLMs); breach notification procedure; access/deletion request procedure |
| Regulations against spam messages and spam email (Decree 91/2020/ND-CP on anti-spam and amending documents) | Campaigns must have opt-in/opt-out, frequency limits, sending time windows, content identifying the sender |
| Law on Electronic Transactions (Luật Giao dịch điện tử), Decree 123/2020/ND-CP on invoices | E-invoices for subscriptions/credit |
| E-commerce | Register/notify the e-commerce website if applicable; clear terms of service, payment policy, refund policy |
| Platform policies (Meta, Zalo, TikTok) | Privacy policy URL, data deletion callback (Meta), comply with messaging policies to avoid having the app blocked — **the biggest business risk** |

Preny has weak legal documentation (policies dated before the company's founding date, terms still containing placeholders) → we do it cleanly from the start: ToS, Privacy, DPA, Acceptable Use, SLA, versioned, with a stored acceptance history for each workspace.

## 10. Data subject rights & data lifecycle

- Export all workspace data (CSV/JSON) — prevents lock-in, and is also a selling point.
- Delete end customers on request: delete/anonymize profile + messages + media; record audit; backups expire automatically on a schedule (stated clearly in the policy).
- Workspace deletion: 30-day soft delete → hard delete + delete object storage + revoke channel tokens.
- Default retention (configurable per plan): messages 24 months; raw webhooks 30 days; technical logs 30 days; ai_runs prompt details 90 days (metrics kept longer).

## 11. Certification goals

Year 1: prepare according to ISO/IEC 27001 (policies, risk register, access management, backup testing). Once there are Enterprise customers: ISO 27001 audit; SOC 2 if selling internationally.
