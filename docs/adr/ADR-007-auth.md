# ADR-007: Build authentication in-house

- Status: Proposed · Date: 2026-10-23

## Decision
15-minute JWT access tokens + opaque refresh token rotation (with reuse detection), Argon2id, TOTP 2FA, Google OAuth, email/phone number OTP. RBAC + scope-based authorization within the app.

## Consequences
Full control over workspace/role and costs; in return we must maintain auth security ourselves (thorough testing, pentest). SAML SSO for Enterprise can be added later via a library/service.
