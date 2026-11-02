# identity

**Purpose:** users, password login, sessions (refresh-token rotation) and access tokens; owns the single global `AuthGuard` that authenticates every non-public route and enforces workspace membership on `@WorkspaceScoped()` routes.

**Owned tables:** `users`, `sessions` (global, app_system only — migration 0001), `user_mfa` (migration 0018), `email_codes` (migration 0056; schema in `packages/db/src/schema/identity.ts`).

**Public API (`api/`):** `IDENTITY_FACADE` (bootstrap helpers) and, for the platform admin only, `IDENTITY_ADMIN_FACADE` → `usersByIds(ids)`, `searchUsers(q, limit)` (email/phone/name substring) returning `{ id, name, email, phone }`. Other modules use `@Public()`, `@WorkspaceScoped()`, `@CurrentUser()`, `@CurrentWorkspace()` from `common/http/auth-context.ts`. HTTP: `/auth/signup|login|refresh|logout`, `/auth/signup/code`, `/auth/signup/business`, `/auth/password/forgot|reset`, `/me`, `/bootstrap`, `/auth/mfa`, `/auth/mfa/setup|enable|disable|recovery-codes` (contracts in `packages/contracts/src/identity/`).

**Events consumed:** none. Uses the `workspace` facade (create the first business in onboarding, membership lookups), the `billing` facade (the first business starts the account's trial; a failure is logged and never blocks it), the `MAILER` port (`common/email`, Resend in production) and the `account` facade (bootstrap lists the user's accounts and the account name of every business, so the web groups businesses by account; a member sees the owning account's name, nothing else about it).

**Invariants:**

- Passwords: Argon2id; 8–128 chars; not common; not equal to email/name. Unknown email and wrong password give the same error and cost the same time.
- Access token: EdDSA JWT, 15 min, claims `sub` (user) + `sid` (session). Refresh token: 32 random bytes, stored only as sha256, 30 days, rotated on every use; presenting a retired token revokes the whole family.
- Web clients get the refresh token only as an HttpOnly cookie scoped to `/api/v1/auth`; cookie refresh checks `Origin` against `APP_ORIGINS`. Native clients use the body (`client: native`).
- A workspace the user is not a member of answers 404, never 403, with `details.reason = 'workspace_access'` so the client can tell a lost business from a missing resource (it reloads bootstrap; T-079). The reason reveals nothing: the same answer is given whether the workspace exists or not.
- Platform admin (`users.is_platform_admin`) is set only by the CLI (`pnpm --filter @agent-sales/backend platform-admin grant|revoke <email>`), exposed read-only as `UserDto.isPlatformAdmin`, and re-checked in the database on every `@PlatformAdmin()` request (non-admins get 404).

- **Two-factor (ADM-04):** TOTP (RFC 6238, SHA-1, 30 s, 6 digits, ±1 step). The secret is sealed with `SecretBox` (`SECRETS_ENCRYPTION_KEY`); recovery codes (8, `xxxxx-xxxxx`) are stored only as sha256. A setup is pending until the first valid code; only then does login ask for a second factor. A code is accepted once (`last_used_step` advanced atomically); a recovery code is burned atomically. Login without a code answers 401 `details.reason = mfa_required`, a wrong one `mfa_invalid`; the per-IP+email attempt counter is only reset after the second factor passes. Setup needs the password; disabling and replacing recovery codes need password + a current code (400 `invalid_password|invalid_code`, not 401, so the session survives). Lost phone and codes: operator runs `pnpm --filter @agent-sales/backend mfa-reset <email>`.

- **Email verification (ACC-01, ADR-023):** `/auth/signup/code` (public, rate-limited per IP, 409 for an email with an account) emails a 6-digit code (sha256 of email + purpose + code in `email_codes`, 15 min, 5 wrong tries then `code_expired`, a new code at most every 60 s → 429 with `retryAfterSeconds`). `/auth/signup` needs the code (400 `code_invalid|code_expired`) and creates the user verified, with no business. `/auth/signup/business` creates the first account + business + trial, 409 `account_exists` once the user owns an account.
- **Password reset:** `/auth/password/forgot` answers 204 for any email (no enumeration; rate-limited per IP); `/auth/password/reset` (rate-limited per IP + email) checks the code and the password policy, sets the password and revokes every session of the user.

**Do not:** read `users`/`sessions` with the tenant connection; log tokens or passwords; add a second global guard.

**Test:** `pnpm --filter @agent-sales/backend test -- identity` and `pnpm test:integration`
