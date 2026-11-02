# ADR-023: Email codes through Resend, a verified email before the account, and the business in onboarding

- Status: Proposed
- Date: 2026-11-02
- Decision makers: thienlng
- Requirement: ACC-01, ACC-07, ACC-09 (docs/02) · related: ADR-021 §6 (signup trial)

## Context

Signup asked for the person (name, email, password) **and** the business (name, industry) on one
form, created the account, the business and the trial at once, and never checked the email. ACC-01
asks for email verification before the dashboard, and the owner wants the business asked for in
onboarding, not on the signup form. There was no way to send email (and so no password reset).

## Decision

1. **Transactional email through Resend.** `common/email/mailer.ts` defines a `Mailer` port with two
   adapters: `ResendMailer` (HTTPS POST to the Resend API, 10 s timeout, logs only the HTTP status)
   when `RESEND_API_KEY` is set, else `LocalMailer` (tests keep the messages in memory; development
   logs them; production logs a warning that no email was sent). Sender: `EMAIL_FROM`, default
   `Rapiz <noreply@rapiz.io>`. Replies go nowhere; support is `support@rapiz.io`.
2. **Email codes, not links.** A 6-digit code, stored only as `sha256(email:purpose:code)` in the
   global table `email_codes` (one row per lower-cased email and purpose, `signup | reset_password`),
   valid 15 minutes, 5 wrong tries, a new code at most every 60 s (429 `RATE_LIMITED` with
   `retryAfterSeconds`). A code works on any device and needs no link handling in the SPA.
3. **The code comes before the account, on the signup page.** The visitor types name and email,
   presses "Send code" (`POST /auth/signup/code`, public, rate-limited per IP; 409 when the email
   already has an account), types the emailed code and a password on the same page, then
   `POST /auth/signup` checks the code and creates the user already verified, with a session. No
   unverified user exists, so there is no verification gate in the token or the guard. Existing
   users are backfilled as verified (migration 0056).
4. **The business in onboarding.** Signup creates no business. A user without one lands on
   `/app/businesses/new`; the first business goes through `POST /auth/signup/business` (identity),
   which creates the account and business and starts the signup trial (best effort, as before). It
   answers 409 once the user owns an account; later businesses use `POST /workspaces`. The route
   sits in identity because `workspace` may not use `billing`.
5. **Login and password reset.** Login stays email + password (+ TOTP). `POST /auth/password/forgot`
   answers 204 for any email; `POST /auth/password/reset` checks the code, sets the password and
   revokes every session of the user.

## Options considered

1. **Create the user first, verify on a second page, gate the API with an `ev` claim**: built first,
   then rejected by the owner: one page is simpler, and no half-created unverified accounts exist.
2. **Magic links**: rejected for now; they open in another browser or the mail app's webview and
   need a landing route; a code is typed into the tab that asked for it.
3. **Passwordless OTP login**: rejected by the owner; passwords stay, the code only proves the email.
4. **A self-hosted SMTP server / Gmail SMTP**: rejected; deliverability (SPF, DKIM, DMARC on
   rapiz.io) is what Resend sells, and a personal mailbox password must not live on a server.

## Consequences

- Production needs `RESEND_API_KEY` and a verified `rapiz.io` domain in Resend; without the key no
  email leaves and nobody can sign up.
- `POST /auth/signup/code` tells whether an email has an account (409), as signup already did.
- The signup trial starts at the first business, not at signup.
