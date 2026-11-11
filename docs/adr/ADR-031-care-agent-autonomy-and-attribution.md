# ADR-031: Care agent: autonomy levels, the 24-hour window without message tags, and attribution

- Status: Proposed
- Date: 2026-11-11
- Decision makers: thienlng (owner decisions in chat, 2026-11-11; spec
  [Care agent, autonomy levels and "Rapiz đã mang lại"](../superpowers/specs/2026-11-11-care-agent-autonomy-design.md))
- Builds on: ADR-030 (Business Brain signals)

## Context

Phase 1 (ADR-030) made Rapiz *tell* the shop who to follow up. Phase 2 makes it *follow up for
the shop*, safely, and shows the money that came back. Three things had to be decided before any
code: how much the AI may do on its own, how it respects Meta's messaging rules, and what counts
as "Rapiz brought this order".

Messenger and Instagram let a page message a customer only within **24 hours** of the customer's
last message. Message tags (`HUMAN_AGENT`: 7 days) are for people, not automated messages.

## Decision

1. **Autonomy levels are a small registry owned by `brain`.** `autonomy_settings(workspace_id,
   action, level)`; one action today, `care.send_message`, levels `suggest` ("đề xuất": the AI
   drafts, a person sends), `act_and_report` ("làm rồi báo": the AI sends, Today lists it under
   "AI đã làm") and `auto` ("tự làm": the AI sends, only the reports mention it). **Default
   `suggest`** for every business (owner decision). `BrainFacade.levelFor(ws, action)` resolves
   the stored level when the action allows it, else the default; `GET|PUT /brain/autonomy`
   (changing it: `settings.manage`; the owner assistant may read but never change it). A level
   only lowers what a template does; a member's message always stops the agent for that
   conversation.
2. **New tier-3 module `care`** (depends on `brain`, `conversation`, `commerce`, `lodging`, `ai`,
   `bot`, `billing`, `identity`; only `dataexport` depends on it). It consumes the outbox
   (`conversation.message.received.v1`, `conversation.reply.completed.v1`, `commerce.order.*`,
   `lodging.booking.created|checked_out.v1` and a new **`brain.signals.updated.v1`**, written by
   brain in the same transaction as every evaluation and stage change) into `care_enrollments`
   (one cycle per conversation and template, keyed by its anchor = the customer message), and a
   worker tick (15 s, `FOR UPDATE SKIP LOCKED`, 2-minute lease, 12 s budget, like brain) runs
   due steps. Templates: *Khách im lặng* (stage exploring / price asked, +2 h and +21 h),
   *Sắp chốt* (ready, +1 h), *Sau mua* (delivered order or checked-out stay → Today's
   "Đến hạn chăm lại" after N days, no message).
3. **The agent messages only inside the 24-hour window and never uses a message tag.** A step
   runs only on Messenger/Instagram, before `last customer message + 24 h` (minus 10 minutes),
   outside 21:00–08:00 Asia/Ho_Chi_Minh (moved to 08:00 when still inside the window), at most 2
   agent messages per conversation in any 24 hours, within a separate daily cap
   `care.messages.daily` (default 100; read from entitlements like brain's cap). Outside the
   window the AI does nothing: the customer stays in Today's queues for a person (owner
   decision). Website chat is skipped until an email follow-up exists. Stop rules before every
   step: template off, conversation closed, the customer opted out (new Brain output `optOut`,
   prompt `brain-signals@2`, column `conversation_signals.opt_out`), the customer wrote again,
   an order/booking, the stage moved, a person wrote or took over, nobody answered the customer.
   Messages are written by one `basic` call (prompt `care-follow-up@1`, ≤ 600 characters or
   `skip`) and sent through `ConversationFacade.commitCareMessage` as **bot messages marked
   `source: 'care'`** (they do not take the conversation from the bot or a person).
   Drafts (`suggest`) wait in Today's **"Chờ duyệt"** queue and expire when the window closes.
   Every agent action writes an audit row (actor `ai:care`; approvals carry the member).
   **Send-time checks.** The stop rules are read once more where a send happens — before every
   step, before an approval is claimed and before a scheduled approved message goes out — so a
   lost outbox event never turns into a wrong send. `commitCareMessage` takes the step's
   *anchor* (the customer message it was written for, stored as `care_messages.anchor_at`) and,
   in the transaction that reserves the message, refuses (CONFLICT, `details.reason`) when the
   customer wrote after the anchor or is waiting for an answer, when the bot does not hold the
   conversation (`mode` ≠ `bot`), when it is closed or out of the window. A customer message
   that lands while the model writes therefore wins: the follow-up is `expired`, the cycle
   stops and the bot can still answer. **Each step sends once:** its message is unique per
   (enrollment, anchor, step) and its send uses the idempotency key
   `care:<enrollment>:<anchor ms>:<step>`; a re-run after a crash or an expired lease writes and
   sends nothing, and sends whose outcome is unknown (`sending`, interrupted) count toward the
   2-per-24 h limit. **The daily cap counts model calls that produced a message** (a draft, a
   send or a model's skip); it is given back when the model failed, the send was refused or
   failed, or the step threw.
7. **Approvals keep the agent's rules (owner rulings, 2026-11-12).**
   - *Quiet hours:* an approval between 21:00 and 08:00 local is accepted and the message is
     `scheduled` for 08:00 (`care_messages.send_at`; Today shows "Sẽ gửi lúc 08:00"). The worker
     sends it then only if the window is still open and the stop rules still pass, else it
     expires. An approval whose 08:00 is already past the window is refused (409
     `CARE_WINDOW_CLOSED`).
   - *Limit:* the 2-per-24 h limit applies to approved messages too (409 `CARE_LIMIT_REACHED`,
     the draft stays to approve later; a scheduled one waits inside the window).
   - *A person holds the conversation:* approving re-checks the mode; a hand-off or takeover
     answers 409 `CARE_TAKEN_OVER` and the draft expires. A change to `human` mode
     (`conversation.control.updated.v1`, hand-off or takeover) or closing the conversation stops
     the cycles and expires the conversation's open drafts and scheduled messages.
   - Other refusals carry their own code (`CARE_CUSTOMER_REPLIED`, `CARE_STOPPED` with the stop
     reason, `CARE_DRAFT_DECIDED`); the draft expires except for `CARE_DRAFT_DECIDED` and
     `CARE_LIMIT_REACHED`.
   - *"Gửi tất cả"* sends the first 5 in the request; the rest are `scheduled` for the worker's
     next tick (a request never waits on 50 Meta calls).
4. **`HUMAN_AGENT` only for a member's own manual send**, between 24 hours and 7 days after the
   customer's last message on Messenger/Instagram, behind `META_HUMAN_AGENT_TAG=true` (off by
   default until the Meta app has the Human Agent permission). Bots and the care agent never get
   it (`replyWindow` in `packages/channels`).
5. **Attribution ("Rapiz đã mang lại") is a query, not a pipeline.** An *AI touch* is a bot reply
   or a care message. An order (commerce, `orders.conversation_id`) or stay booking (lodging) is
   attributed when created within **7 days after an AI touch in the same conversation**: `ai`
   when no member messaged between the first such touch and the order, `ai_staff` when one did.
   `GET /brain/impact?range=today|7d|30d` (served by `care`) sums counts and revenue (integer
   VND; booking sell totals), plus follow-ups sent and replies; the Monday morning briefing adds
   the 7-day line. Read through `CommerceFacade.conversationOrders`,
   `LodgingFacade.conversationBookings` and `ConversationFacade.aiTouches` (per sale, in SQL:
   the first AI touch in the 7 days before it and whether staff wrote after it; nothing is
   truncated). "Replies" counts customers (one per conversation) who wrote after a follow-up.
6. **Today shows care without a dependency cycle.** brain exposes `BRAIN_TODAY_REGISTRY`; care
   registers a `CareTodaySource` at start-up (drafts for "Chờ duyệt", due after-sales check-ins,
   the impact). Today and the briefing work without it.

## Consequences

- No automated message ever leaves outside Meta's window, and no tag is ever used by a bot: the
  page is not put at risk by the agent. The cost is that "asked a price and went quiet for 3 days"
  stays a person's job (with `HUMAN_AGENT` once enabled).
- Two caps per business (evaluations 200, care messages 100), shown separately.
- Five tenant tables + `care_checkpoints` (global) in migration 0075, additive; the data export
  gains `care_messages.csv` and `care_enrollments.csv` (usage and settings are not exported).
- "Every AI touch counts" makes bot-handled sales show as AI — intended: the bot is the AI. The
  figures are a lower bound for care follow-ups and an upper bound for "AI alone".
- `TodayResponse` gains the `approval` queue and `TodayCounts.approval` (additive).
- **Deferred:** the writer is grounded in the bot's profile facts only, not yet in the product
  catalogue the bot uses (spec §4 asks for both); catalogue grounding is a follow-up.

## Alternatives considered

- **Message tags or Marketing Messages for the agent.** Rejected: tags are for people (Meta
  policy); Marketing Messages need opt-in and their availability in Vietnam is unclear.
- **Automatic call tasks outside the window.** Rejected by the owner: leave it to people.
- **Autonomy per template instead of per action.** Rejected: one action, one level is simpler to
  explain; templates have their own on/off and instruction.
- **An attribution event pipeline / read model.** Rejected for now: the query over three facades
  is cheap at current volumes and cannot drift.
- **Approval queue inside `brain`.** Rejected: drafts are care's data; a registry keeps the
  dependency one-way.
