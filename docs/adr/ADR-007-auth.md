# ADR-007: Build authentication in-house

- Status: Proposed · Date: 2026-10-23

## Decision
15-minute JWT access tokens + opaque refresh token rotation (with reuse detection), Argon2id, TOTP 2FA, Google OAuth, email/phone number OTP. RBAC + scope-based authorization within the app.

## Google sign-in (2026-11-11, implemented)

- Authorization code flow with PKCE, `state` and `nonce`, run on the server (`/api/v1/auth/google/start` → Google → `/api/v1/auth/google/callback`), not Google Identity Services in the browser: the button keeps the product's design, the SPA never handles a Google credential, and the same refresh-cookie session as a password login is issued.
- Users are linked by Google's `sub` in a new global table `user_identities` (migration 0072), never by email alone after the first link, so a changed Google address still signs in. First use links to the user with the same email (Google vouches for it via `email_verified`), else creates a password-less user (`users.password_hash` null); such a user can add a password through the password reset.
- Two-factor still applies after Google. Email signup stays: not everyone has a Google account, and Google refuses sign-in inside embedded browsers (Zalo, Facebook in-app).
- Config: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_REDIRECT_URI`. Unset, the button shows "coming soon".

## Consequences
Full control over workspace/role and costs; in return we must maintain auth security ourselves (thorough testing, pentest). SAML SSO for Enterprise can be added later via a library/service.
