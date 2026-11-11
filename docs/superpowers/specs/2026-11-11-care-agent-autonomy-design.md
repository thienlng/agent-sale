# Care agent, autonomy levels and "Rapiz đã mang lại" — design

Date: 2026-11-11 · Status: approved (owner asked to build it; open questions decided by the product owner agent) · Phase 2 of the Agentic Business OS roadmap ·
Builds on: [Business Brain v1 and Today](2026-11-11-business-brain-today-design.md), ADR-030

## 1. Goal

Turn Rapiz from "tells you who to follow up" into **"follows up for you"**, safely, and prove the
money it brings back:

1. **Care agent** — follows up with customers who went quiet, on the channels we already have
   (Messenger, Instagram, website chat), from three templates.
2. **Autonomy levels** — per business and per kind of action: *đề xuất* (AI drafts, a person
   sends), *làm rồi báo* (AI sends, reports in Today), *tự làm* (AI sends, only the daily report).
3. **"Rapiz đã mang lại"** — orders/bookings and revenue that followed an AI touch, shown on Today
   and in the briefing.

Out of scope: Zalo OA/ZNS, SMS, email campaigns, payments (phase 4, waiting for the company
registration); a drag-and-drop workflow builder (WFL-07); AI changing CRM status or orders.

## 2. The hard constraint: Meta's 24-hour window

Messenger and Instagram only let a page message a customer **within 24 hours of the customer's
last message** (the code already enforces it: `conversation.facade.impl.ts`, "The 24-hour
messaging window is closed"). Message tags such as `HUMAN_AGENT` are for people, not bots, and we
do not use them for the agent.

Consequences that shape the whole design:

- A follow-up must be sent **inside the window**. The useful moments are "a while after we went
  quiet" (+2 h) and "last chance" (+20–22 h). "Hỏi giá rồi im 3 ngày" can no longer be messaged on
  Messenger: it becomes a **task for a person** (call the phone number if we have one) instead.
- Website chat has no window but the visitor is usually gone: follow up there only when the
  visitor left an email (0071) → an email follow-up, or skip.
- After-sales check-ins (days after an order) fall outside the window → task for a person now,
  ZNS in phase 4.

Two ways to widen it, both in scope here:

- **`HUMAN_AGENT` tag for members (7 days).** Meta allows a *human* reply up to 7 days after the
  customer's message with this tag; it forbids automated messages. Today Rapiz blocks every send
  after 24 h, even a member's. Add: a member's manual send between 24 h and 7 days goes out with
  `tag: HUMAN_AGENT` (needs the app's Human Agent permission, applied for in the Meta app
  dashboard). Today's "Soạn trả lời" then works for "hỏi giá rồi im 3 ngày": the AI drafts, the
  member reads and presses Gửi. The care agent itself never uses the tag.
- **Marketing Messages (paid, opt-in)** can reach people outside the window; availability in
  Vietnam and the replacement of Recurring Notifications in 2026 are unclear — verify before
  designing anything on it (not in this phase).

Owner decision (2026-11-11): **outside the window the AI does nothing** — the customer stays in
Today's queues and a member decides whether to message them (manually, with `HUMAN_AGENT` up to
7 days). The agent creates no call tasks on its own. So the care agent is **"message inside the
window, otherwise leave it to people"**.

## 3. Templates (WFL-01, simplified)

| Template | Enters when | Steps (inside the window) | Outside the window |
|---|---|---|---|
| **Khách im lặng** | Brain stage `exploring` or `price_asked`, the last message was ours, customer silent ≥ 2 h | 1 message at +2 h (answer the open question, one useful detail); 1 "last chance" at +21 h | stays in Today ("Hỏi giá rồi im" / "Đến hạn chăm lại") for a member |
| **Sắp chốt** | stage `ready`, no order/booking yet | 1 message at +1 h (recap of what they chose + how to order/book) | stays in Today ("Sắp chốt") for a member |
| **Sau mua** | an order/booking is completed | — (no window) | appears in Today's "Đến hạn chăm lại" at +N days (setting, default 3) |

Each business turns templates on/off and can edit a short **instruction** per template (tone, an
offer to mention). Defaults: *Khách im lặng* and *Sắp chốt* on, *Sau mua* on.

**Stop rules** (checked before every step, and on every new event): the customer replied; an
order/booking was placed; stage became `won`, `lost` or `spam`; a person sent a message or took the
conversation (assignee mode / handoff); the customer asked not to be contacted (the Brain
evaluation gets one more field: `optOut`); the conversation was closed. At most **2 agent messages
per conversation per 24 h** and never between **21:00 and 08:00** (business time zone) — a step
that would land in quiet hours moves to 08:00 if still inside the window, else becomes the
"outside the window" path.

Approved drafts follow the same rules (owner ruling, 2026-11-12, ADR-031 §7): approving in the
quiet hours schedules the message for 08:00 (sent then only if the window is still open and the
stop rules still pass), the per-conversation limit applies, and a draft cannot be approved while
a person holds the conversation (it expires).

## 4. Writing the message

- One `basic`-tier call per message, input: the Brain note + last 20 messages + bot persona and
  catalog grounding the bot already uses + the template's goal and the owner's instruction.
- *Deferred (built as of 2026-11-12):* the writer gets the bot persona and profile facts but not
  yet the product catalogue; catalogue grounding is a follow-up (ADR-031 Consequences).
- Output: the message text (≤ 600 chars) or `skip` with a reason (e.g. "nothing useful to add").
- Counts against a **separate daily cap** `care.messages.daily` (default 100 per business) so
  follow-ups never starve signal evaluation, with the same usage display as signals.
- Sent through the conversation module as a bot message marked `source: care`, so the inbox shows
  it like a bot reply, with a small "Chăm sóc tự động" label.

## 5. Autonomy levels

A small registry owned by `brain` (it already owns per-business AI settings):

| Action | Default | Levels allowed |
|---|---|---|
| `care.send_message` | **đề xuất** | đề xuất · làm rồi báo · tự làm |

- **Đề xuất:** the draft lands in a new Today queue **"Chờ duyệt"** with Gửi / Sửa rồi gửi / Bỏ.
  A draft expires when its window closes (then the outside-window path applies). Bulk "Gửi tất
  cả" for the queue.
- **Làm rồi báo:** sent at the scheduled time; Today shows a **"AI đã làm"** list (what was sent,
  the customer's reaction) and the briefing counts it.
- **Tự làm:** sent; only the daily briefing and the report mention it.
- Settings → Trợ lý / Chăm sóc tự động: per template on/off + instruction, the level per action,
  quiet hours, the cap and today's usage.
- Every agent action is written to the audit trail (actor `ai:care`), and the assistant's
  proposals keep their own approval flow (not changed here).

Rule: the level can only make the AI do **less** than the template allows, never more; a
member's message in the conversation always stops the agent for that conversation.

## 6. "Rapiz đã mang lại"

- An **AI touch** is a care message or a bot reply in a conversation.
- An order (or a lodging booking) is **attributed** when it is created within **7 days** after an
  AI touch in the same conversation (orders already carry `conversation_id`) and no member
  messaged in between; partly, when a member also messaged ("AI + nhân viên").
- Figures per business: follow-ups sent, replies received, orders and revenue attributed (AI
  alone / AI + staff), for today, 7 days, 30 days. Computed by a query over `care_messages`,
  conversation messages and commerce/lodging facades — no new event pipeline.
- Shown: a strip on Today ("30 ngày qua Rapiz đã mang lại 12 đơn · 8,4 triệu"), the morning
  briefing once a week (Monday), and the assistant can read it through a route.

## 7. Architecture and data

- New module **`care`** (tier 3), depends on `brain` (signals, autonomy, caps), `conversation`
  (send, window, messages), `crm` (tasks, phone), `commerce` and `lodging` (orders/bookings for
  stop rules and attribution), `notification`, `workspace`. Nothing depends on it.
- Triggers: `care` consumes the outbox (`conversation.message.received.v1`,
  `conversation.reply.completed.v1`, commerce order events, brain signal updates — a new
  `brain.signals.updated.v1` event) into `care_enrollments`; a worker tick runs due steps with
  `FOR UPDATE SKIP LOCKED`, like brain.
- Tables (one migration): `autonomy_settings(workspace_id, action, level)`,
  `care_templates(workspace_id, key, enabled, instruction, params jsonb)`,
  `care_enrollments(workspace_id, conversation_id, template, step, next_at, status, stop_reason)`,
  `care_messages(id, workspace_id, conversation_id, enrollment, text, status
  draft|sent|expired|rejected|skipped, window_closes_at, sent_message_id, decided_by, created_at)`,
  `care_usage(workspace_id, day, count)`. All with RLS; exported (SET-10) except usage.
- Brain change: the evaluation output gains `optOut: boolean`; signals emit
  `brain.signals.updated.v1`.
- ADR-031: autonomy levels, the 24-hour-window rule and why the agent never uses message tags,
  attribution definition.

## 8. Testing

- Domain: window math (+ quiet hours, time zone), stop rules, per-day message limit, level
  resolution, expiry of drafts, attribution windows.
- Integration: an enrolled conversation → draft in "Chờ duyệt" → approve → sent through the
  conversation facade (fake channel) → customer replies → enrollment stops; order within 7 days →
  attributed.
- Never send to real Facebook Pages in tests or on dev (dev has none connected); use the fake
  channel and the website chat.
- Measure on dev: drafts for ~20 conversations, token cost per message, share of `skip`.

## 9. Delivery

One branch, one PR (`feat/care-agent`), after the Today PR is merged. Estimated ~1–1.5 weeks of
agent work, parallelised the same way (backend care module ‖ docs/ADR ‖ then web).

## 10. Open questions for the owner

1. ~~Default send level~~ — decided: **đề xuất** for every business.
2. ~~Fallback outside the window~~ — decided: leave it to people (Today queues), no automatic tasks.

## 11. Decisions

- Default level for `care.send_message`: đề xuất.
- `HUMAN_AGENT` for member sends between 24 h and 7 days ships behind the env flag `META_HUMAN_AGENT_TAG=true` (off by default) because the app needs Meta's Human Agent permission first.
- Migration number: next after the Today PR's (renumbered at merge time).
