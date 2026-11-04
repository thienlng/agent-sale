# notification

**Purpose:** Tier-0 delivery of notices to a user (T-172, S3-R5…R8): the in-app notification behind the dashboard bell, and its email (through the backend `Mailer`, Resend, ADR-023) and Web Push deliveries (T-190, installable app). Producers render the text; this module stores, lists and delivers it.

**Owned tables:** `notifications`, `notification_deliveries` (schema in `packages/db/src/schema/notification.ts`, migration 0061), `push_subscriptions` (migration 0066, T-190: one row per browser push endpoint and account; `UNIQUE (account_id, endpoint)`, a re-registration moves the row to the caller). Account-scoped: `accountPolicies` + `withAccount`, and every query also filters on `user_id`. The delivery runner works as `app_system`.

**Public API (`api/`):**

- `NOTIFICATION_FACADE` → `NotificationFacade`:
  - `notify(input)` stores the in-app row and queues one delivery per other channel, in one transaction; a repeated `dedupKey` for the same user stores nothing (`{ deduped: true }`). An `email` delivery while email is off is stored `skipped` (`email_disabled`). A `path` target must stay inside the dashboard (`/app` or `/app/…`, the web `safeAppPath` rule).
  - `recipientLocale(userId)` (`vi` unless the user chose `en`), so the producer renders in it.
  - `emailAvailable()`: false when `RESEND_API_KEY` is unset.
  - `deliverySummary(accountId, userId, ids)`: per notification, the status of each channel.
- `NOTIFICATION_RUNNER` → `NotificationRunner.tick(now?)`: run by the `worker` entry every 5 s.
- HTTP (`@WorkspaceScoped()`, `assistant: never`): `GET /notifications` (keyset), `GET /notifications/unread-count`, `POST /notifications/{notificationId}/read`, `POST /notifications/read-all`; Web Push (T-190): `GET /notifications/push` (`{publicKey}`, null while the VAPID keys are unset), `POST /notifications/push/subscriptions` (register this browser's `PushSubscription` JSON for the caller, idempotent per endpoint; 400 `push_unavailable` while push is off), `POST /notifications/push/subscriptions/remove` (`{endpoint}`).
- Targets: `{kind:'path'}`, `{kind:'assistant_report'}` and `{kind:'conversation', conversationId}` (T-190; opens `/app/inbox?conversation=…&ws=<workspaceId>`, the app switches business first). The current business gives the account (`workspace.accountOf`); any member may call them and only sees their own rows.
- Events: none.

**Uses:** `identity` (`profile`: recipient address and locale), `workspace` (`accountOf`). Nothing it uses may depend on it, and it never calls a producer back.

**Events consumed:** none. Producers call the facade directly (synchronous, idempotent by `dedupKey`).

**Invariants:**

- A user only ever reads or changes their own rows; another user's (or account's) id behaves as absent (404).
- One delivery per notification and channel; in-app delivery is the notification row itself.
- Email goes only to the user's own login address, at most 20 per user per 24 h (`daily_cap`).
- A failed send is retried 1, 5 and 30 minutes later, then `failed` with the error class as `error_code`. Delivery is at-least-once (a crash between a send and the status write can resend once). The attempt is counted before the send; a reclaimed `sending` delivery whose 4 attempts are used up is `failed` (`send_interrupted`) without another send.
- A channel with no adapter, or push without `WEB_PUSH_PUBLIC_KEY`/`WEB_PUSH_PRIVATE_KEY`, gives `skipped` (`channel_unavailable`, decided when the notification is stored); no address (email) or no registered device (push) gives `skipped` (`no_recipient`).
- Push (`infrastructure/clients/web-push.channel.ts`, `web-push` + VAPID): one encrypted message `{title ≤ 120, body ≤ 240, url, tag}` to every device of the user on the account (max 10, oldest first), TTL 24 h, urgency high; `url` is the relative in-app link (`targetHref`), `tag` is the dedup key without its last `:n` part so a device shows one notification per conversation. A 404/410 from the push service deletes the device; the delivery fails (and is retried) only when no device took it.
- Notifications are purged after 90 days (deliveries cascade).

**Do not:** read other modules' tables; call a producer back; log addresses, titles or bodies; send to an address other than the user's login email.

**Test:** `pnpm --filter @agent-sales/backend test -- notification`; HTTP and Postgres: `test/notification-http.integration.spec.ts`, `test/schedules-notifications.integration.spec.ts`.
