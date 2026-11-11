# ADR-007: Build authentication in-house

- Status: Proposed · Date: 2026-10-23

## Decision
15-minute JWT access tokens + opaque refresh token rotation (with reuse detection), Argon2id, TOTP 2FA, Google OAuth, email/phone number OTP. RBAC + scope-based authorization within the app.

## Google sign-in (2026-11-11, implemented)

- Authorization code flow with PKCE, `state` and `nonce`, run on the server (`/api/v1/auth/google/start` → Google → `/api/v1/auth/google/callback`), not Google Identity Services in the browser: the button keeps the product's design, the SPA never handles a Google credential, and the same refresh-cookie session as a password login is issued.
- Users are linked by Google's `sub` in a new global table `user_identities` (migration 0072), never by email alone after the first link, so a changed Google address still signs in. First use with a never-seen email creates a password-less user (`users.password_hash` null); such a user can add a password through the password reset.
- **Linking to an existing account (decided 2026-11-11, PR #169 review):** a first Google sign-in links to the existing user with the same email only when Google is authoritative for the address: it ends in `@gmail.com`, or the ID token's `hd` claim equals the address's domain (a Google Workspace account of that domain). For any other address `email_verified` only means the address was verified once, when the Google account was made, so a former owner of the mailbox could take over the Rapiz account. Those sign-ins are refused with `google_error=account_exists` ("sign in with your password"); linking them from inside the account is a possible later addition.
- Two-factor still applies after Google, and the link (plus confirming an unverified address, dropping its password and signing it out everywhere) happens only after the code checks out.
- Failed callbacks are throttled per IP on their own limiter (60 per 15 min, reset by a completed sign-in); callbacks without a live flow cookie never reach Google and are not counted, so CGNAT and office IPs are not locked out by successful sign-ins. Email signup stays: not everyone has a Google account, and Google refuses sign-in inside embedded browsers (Zalo, Facebook in-app).
- Config: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_REDIRECT_URI`. Unset, the button shows "coming soon".

## Consequences
Full control over workspace/role and costs; in return we must maintain auth security ourselves (thorough testing, pentest). SAML SSO for Enterprise can be added later via a library/service.
