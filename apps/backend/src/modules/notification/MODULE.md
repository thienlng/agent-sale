# notification

**Purpose:** Tier-0 delivery of notices to a user (T-172, S3-R5…R8): the in-app notification behind the dashboard bell, and its email (SMTP) and push deliveries. Producers render the text; this module stores, lists and delivers it.

**Owned tables:** `notifications`, `notification_deliveries` (schema in `packages/db/src/schema/notification.ts`, migration 0060). Account-scoped: `accountPolicies` + `withAccount`, and every query also filters on `user_id`. The delivery runner works as `app_system`.

**Public API (`api/`):**
- `NOTIFICATION_FACADE` → `NotificationFacade`:
  - `notify(input)` stores the in-app row and queues one delivery per other channel, in one transaction; a repeated `dedupKey` for the same user stores nothing (`{ deduped: true }`). An `email` delivery while email is off is stored `skipped` (`email_disabled`). A `path` target must stay inside the dashboard (`/app` or `/app/…`, the web `safeAppPath` rule).
  - `recipientLocale(userId)` (`vi` unless the user chose `en`), so the producer renders in it.
  - `emailAvailable()`: false when `SMTP_URL` is unset.
  - `deliverySummary(accountId, userId, ids)`: per notification, the status of each channel.
- `NOTIFICATION_RUNNER` → `NotificationRunner.tick(now?)`: run by the `worker` entry every 5 s.
- HTTP (`@WorkspaceScoped()`, `assistant: never`): `GET /notifications` (keyset), `GET /notifications/unread-count`, `POST /notifications/{notificationId}/read`, `POST /notifications/read-all`. The current business gives the account (`workspace.accountOf`); any member may call them and only sees their own rows.
- Events: none.

**Uses:** `identity` (`profile`: recipient address and locale), `workspace` (`accountOf`). Nothing it uses may depend on it, and it never calls a producer back.

**Events consumed:** none. Producers call the facade directly (synchronous, idempotent by `dedupKey`).

**Invariants:**
- A user only ever reads or changes their own rows; another user's (or account's) id behaves as absent (404).
- One delivery per notification and channel; in-app delivery is the notification row itself.
- Email goes only to the user's own login address, at most 20 per user per 24 h (`daily_cap`).
- A failed send is retried 1, 5 and 30 minutes later, then `failed` with the error class as `error_code`. Delivery is at-least-once (a crash between a send and the status write can resend once).
- A channel with no adapter (push today) gives `skipped` (`channel_unavailable`); no address gives `skipped` (`no_recipient`).
- Notifications are purged after 90 days (deliveries cascade).

**Do not:** read other modules' tables; call a producer back; log addresses, titles or bodies; send to an address other than the user's login email.

**Test:** `pnpm --filter @agent-sales/backend test -- notification`; HTTP and Postgres: `test/notification-http.integration.spec.ts`, `test/schedules-notifications.integration.spec.ts`.
