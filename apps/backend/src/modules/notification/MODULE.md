# notification

**Purpose:** Tier-0 delivery of notices to a user: the in-app notification (the dashboard bell) and its email/push deliveries (T-172, S3-R5…R8).

**Owned tables:** `notifications`, `notification_deliveries` (schema in `packages/db/src/schema/notification.ts`, migration 0060). Account-scoped: `accountPolicies` + `withAccount`, and every query also filters on `user_id`.

**Public API (`api/`):**
- `NOTIFICATION_FACADE` → `NotificationFacade` (filled in by the next step of T-172).

**Events consumed:** none. Producers call the facade directly.

**Invariants:**
- A user only ever reads or changes their own rows; another user's id behaves as absent.
- `dedup_key` is unique per user; a repeated notify stores nothing.
- One delivery row per notification and channel; in-app delivery is the notification row.

**Do not:** read other modules' tables; call a producer back; log addresses, titles or bodies.

**Test:** `pnpm --filter @agent-sales/backend test -- notification`
