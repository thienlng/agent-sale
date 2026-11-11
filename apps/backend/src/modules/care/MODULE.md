# care

**Purpose:** the care agent (spec `docs/superpowers/specs/2026-11-11-care-agent-autonomy-design.md`, ADR-031): follows up with customers who went quiet, inside Meta's 24-hour window only, from three templates (Khách im lặng, Sắp chốt, Sau mua); drafts for a person ("Chờ duyệt") or sends by the business's autonomy level; "Rapiz đã mang lại" (attribution).

**Owned tables:** `care_templates`, `care_enrollments`, `care_messages`, `care_usage`, `care_checkpoints` (global, app_system only: outbox position `care.enroll`) (schema `packages/db/src/schema/care.ts`, migration 0074).

**Public API (`api/`):**
- `CARE_FACADE` → `messagesOf(ws, conversationId)` (≤ 50, newest first).
- `CARE_RUNNER.tick()` — worker, every 15 s: outbox pass → expire drafts whose window closed and sends stuck in `sending` > 10 min → claim 5 due steps at a time (`FOR UPDATE SKIP LOCKED`, 2-minute lease) while due and < 12 s passed.
- `CARE_EXPORT` — `care_messages.csv`, `care_enrollments.csv` (SET-10).
- HTTP (`packages/contracts/src/care/`): `GET /care/settings`, `PUT /care/templates/{key}` (`settings.manage`), `POST /today/approval/{id}/approve` (body `{text?}`), `POST /today/approval/{id}/reject`, `POST /today/approval/approve-all` (body `{ids?}`, ≤ 50) (`contacts.edit`), `GET /today/ai-done` (`contacts.view`), `GET /brain/impact?range=today|7d|30d` (`analytics.view` + `contacts.view_all`).
- Registers `CareTodaySourceImpl` with brain's `BRAIN_TODAY_REGISTRY` at start-up: Today's `approval` queue and count, due after-sales check-ins in `follow_up`, the Monday briefing's 7-day impact.

**Events consumed (outbox, transaction horizon like brain):** `conversation.message.received.v1` (customer → stop `customer_replied`; echo → `member_message`; also a due after-sales check-in), `conversation.reply.completed.v1` (sender `human`, sent → `member_message`), `brain.signals.updated.v1` (exploring/price_asked → enroll `silent`, ready → `ready`, only when the signal's `evaluatedUntil` covers the last customer message, the other stops; won/lost/spam/after_sale → `stage_changed`; optOut → `opted_out`), `commerce.order.created.v1` / `lodging.booking.created.v1` → `ordered`, `commerce.order.status_changed.v1` (to `delivered`) / `lodging.booking.checked_out.v1` → enroll `after_sale` (+N days). Events older than a day start no cycle. Publishes none.

**Uses:** `brain` (`signalsFor`, `levelFor`, `BRAIN_TODAY_REGISTRY`), `conversation` (`followUpFacts`, `signalContext`, `get`, `todayCandidates`, `commitCareMessage`, `outboundTimeline`), `commerce` (`latestOrderTimes`, `conversationOrders`), `lodging` (`latestBookingTimes`, `conversationBookings`), `ai` (`AI_LLM_GATEWAY`), `bot` (`getBot`: persona and profile facts), `billing` (`entitlements` → `care.messages.daily`), `identity` (`displayName`).

**Invariants:**
- A cycle is keyed by (conversation, template) and its anchor (the customer message); only a newer anchor restarts it. Steps: silent +2 h / +21 h, ready +1 h after the anchor.
- Before every step (`domain/care.ts` `stopReason`): template on, conversation open, not opted out, no newer customer message, no order/booking after the anchor, stage still the template's, no member message after the anchor, mode `bot`, last message not the customer's.
- Messenger/Instagram only; a step runs before `anchor + 24 h − 10 min`, never 21:00–08:00 Asia/Ho_Chi_Minh (moved to 08:00 inside the window), ≤ 2 sent agent messages per conversation in 24 h, within `care.messages.daily` (default 100; reserved before the call, released on failure). Outside the window: the cycle stops, nothing is sent. Never a message tag.
- One tier-`basic` call (`care-follow-up@1`, 600 tokens, 20 s, one retry on invalid output) → ≤ 600 chars or `skip`. Level `suggest` → `draft` (expires at the window's close; a newer draft expires the older); `act_and_report`/`auto` → sent at once via `commitCareMessage` (`care:<id>` idempotency, bot message `source: care`).
- Approve claims `draft → sending` only while the window is open; a closed window → `expired` (409). Sales/care see their own and unassigned customers' drafts only (404 otherwise).
- Every agent action writes `audit_events` (`care.message.drafted|sending|skipped|sent|failed|rejected`, actor `ai:care` or the member).
- Attribution (`domain/attribution.ts`): an order/booking within 7 days after a bot reply or care message in the conversation; `ai_staff` if a member wrote after the first such touch.

**Do not:** send outside the window or with a tag; read other modules' tables; create call tasks on its own (owner decision); change CRM status or orders.

**Test:** `pnpm --filter @agent-sales/backend test -- care` (+ `test/care-flow.spec.ts`, `test/care-http.spec.ts`; `test/care-store.integration.spec.ts` with `test:integration`)
