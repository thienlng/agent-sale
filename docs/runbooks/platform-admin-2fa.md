# Runbook — platform admin two-step verification

Since migration 0078 the back office (`/admin/*`, ADR-021 §6) refuses a platform admin who has not
turned on two-step verification, and a sign-in that did not pass it (security audit #7). This
runbook covers the rollout and the day-to-day cases.

## What the server checks

On every `@PlatformAdmin()` request, after the admin flag:

| Check | Answer when it fails | Fix |
|-------|----------------------|-----|
| Two-step verification is on for the account | 403 `admin_mfa_required` | Turn it on in Account security |
| This session passed it (login code, a two-step step-up, or turning it on in this session) | 403 `mfa_session_required` | Enter an authenticator code when `/admin` asks |
| A recent step-up for payment confirmation, plan, override, trial, billing-settings and account status changes, and every LLM provider or tier change | 403 `reauth_required` | Enter an authenticator code when asked (valid `AUTH_STEP_UP_WINDOW_MINUTES`, default 10) |

The first check reads the database on every request; the second reads it whenever the cached
session state does not already show the second factor, so a fresh code takes effect at once.
Account security is a normal
dashboard page, not an admin route, so an admin can always reach it to turn two-step on: nobody
is locked out by the rollout itself.

## Before deploying the release with migration 0078

1. List the platform admins:
   `docker compose exec postgres psql -U rapiz_owner -d rapiz -c "select email from users where is_platform_admin"`
2. Ask each of them to turn on two-step verification now (avatar → Account security → Turn on).
   This works on the current release too, so the change is invisible to them after the deploy.
3. Revoke admins who no longer need it:
   `docker compose exec api node apps/backend/dist/cli/platform-admin.js revoke <email>`

## After the deploy

- An admin who already had two-step on and is still signed in from before the deploy sees
  "Confirm with your authenticator" on `/admin`: those sessions were created before the server
  recorded the second factor. One code and the session is marked; signing in again also works.
- An admin without two-step sees "Turn on two-step verification" with a link to Account security.
  Turning it on in that session also unlocks `/admin` at once.
- The admin web shows these as pages, not as failed loads; the API answers above are what scripts
  and other clients see.

## Lost authenticator

Same as for any user: the admin uses a recovery code, or an operator runs
`docker compose exec api node apps/backend/dist/cli/mfa-reset.js <email>` after checking the
person's identity out of band. After a reset the admin must turn two-step on again before
`/admin` opens.

## Rolling back

There is no switch to turn the admin check off: it is part of the code. Rolling back means
deploying the previous image; migration 0078 is additive, so the previous release runs on the
migrated schema unchanged (docs/10 §3).
