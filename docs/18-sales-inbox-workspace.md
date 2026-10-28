# Sales inbox workspace

The inbox at `/app/inbox` keeps the conversation visible alongside customer context and commerce order creation. The route composes the conversation, CRM and commerce features; features do not import one another.

## Meta-style layout (T-096)

Since T-096 the inbox follows the Meta Business Suite inbox ([BA specification](business/rapiz-inbox-meta-ba.vi.md)), in Rapiz colours:

- **Frame.** Title row with a link to messaging statistics; one card with the channel tabs over the conversation list and the thread; the customer panel as a second card beside it (collapsible; on narrow screens list → thread → panel, each with back navigation). The panel is portalled into a page-owned region so opening a conversation never remounts the list or loses its scroll position.
- **Channel tabs.** All messages, Messenger, Instagram and Website (the website chat channel, T-097..T-104) filter by provider (a page filter of the other provider is dropped). "Facebook comments" explains that comments are handled on the Page's posts-and-comments screen and links there; WhatsApp and Instagram comments are shown as not supported, not as empty lists.
- **List.** Search plus "Quản lý" (bulk mode). Quick filters apply at once and show their state: unread and awaiting reply (server counts, mutually exclusive queue tabs), priority (star) and follow-up. The advanced filter (tags, assignee, folder, waiting kind, reply mode, page, phone) edits a draft: "Áp dụng" applies it, "Xóa tất cả" resets the draft, closing discards it; search, tabs and quick filters are never touched by it. Viewing Done or Spam shows a "Đang xem" line with a way back.
- **Bulk mode.** Rows get tick boxes and a click ticks instead of opening. "Select all" covers the rows on screen only. Actions: done/reopen, priority, read/unread, spam, assign, remove follow-up. A partial failure reports both counts and keeps only the failed rows selected so "retry" repeats just those. Any change of search, tab or filter clears the selection with a notice.
- **Thread header.** Customer, page and Meta's "Chỉ định cuộc trò chuyện này" assignee menu; reply mode; icon actions with tooltips for spam, priority, mark unread and done (`E`); more (search in thread, open on Facebook); panel toggle.
- **Thread and composer.** Messenger-style bubbles (outbound in the brand colour, customer avatar on the last bubble of a run, centred time between runs over 30 minutes). Sender and delivery state stay visible on outbound messages. The composer names the channel ("Trả lời trong Messenger…") and has attach, quick replies, emoji, product sharing and send. While the draft is empty the send button is Meta's 👍, which sends a real 👍 message. In Done or Spam the draft stays editable but nothing can be sent; a banner offers "Mở lại". Without `contacts.edit` (for example the analyst role) the composer says the conversation is view-only and every control is disabled; a refused send says it was a permission problem.
- **Customer panel.** Profile header, then About (phone, CRM profile link), Labels (conversation tags from Customer settings, "Quản lý nhãn" link), Notes, Orders, Follow-up, Shared photos (pictures in the loaded messages only, labelled as such).

Not in this slice (spec §16 decision gates): comment threads inside the inbox, automation, inbox settings, calls/payments, real delete/block/report, lead stage/quality and ad-reply filters, commerce markers, availability/tasks/notifications, direct file upload, shop/bot filters (T-087).

## Queues and filters

> The sections below describe the T-068 workspace; where they disagree with the T-096 layout above, the layout above is current.

The left column provides all conversations, staff handling, assigned to me, unassigned, AI handling and follow-ups due queues. A follow-up is due only when its saved UTC timestamp has passed and the conversation is open; the due count refreshes at least once per minute. This queue shares the latest-100-result limit and is not a comprehensive reminder scheduler. Counts refer to the latest loaded results (at most 100), not workspace totals. Page/account, provider, status and reply mode filters apply before queue counts. The staff queue describes ownership mode: it does not claim that the latest message is unanswered. The API currently does not expose unread state or the last sender in the list DTO.

Saved views keep up to five filter combinations on the current device, separately for each user and workspace. They exclude customer search text, can be applied or deleted, and surface storage failures. They are not shared with teammates or synchronized between devices.

Keyboard shortcuts `J`/`K` switch visible conversations, `/` focuses inbox search, `R` focuses the visible reply/private-note editor and `E` resolves or reopens the selected conversation. Editors, dialogs, menus, IME composition and modified key combinations keep their normal behavior.

## Conversation work

The customer panel can be collapsed on desktop to widen the thread. The header shows the reply owner mode, resolution status and any automatic AI resume time. Staff can take over, resume an active bound bot, resolve/reopen a conversation, or search the loaded messages. Search covers the current API result, not archived history. New arrivals do not interrupt an operator reading older messages; the jump-to-latest action uses message identity so a full 200-message window still detects arrivals.

The composer has separate customer reply and internal note modes. Product sharing selects a real catalog variant and inserts its name, variant and current price at the caret; it does not send automatically. Quick replies insert at the selection instead of replacing the draft. Attachments are previewed and explicitly sent separately from text, matching the current outbound API contract. Sending restrictions apply to outbound customer messages; notes and order creation remain available.

Text, attachment and internal-note drafts are scoped by user, workspace and conversation and kept in tab memory. They survive switching customers and update when an in-flight send finishes after switching away and back. Reloading or closing the tab discards drafts. A definitive failed send can be explicitly retried with a new idempotency key. An unconfirmed transport failure reuses the original key; pending/unknown outcomes are shown without automatic duplicate sending.

Internal notes append to the conversation's shared note with a captured `expectedRevision`. The optional nonnegative revision on conversation PATCH rejects stale writes with `CONFLICT` while preserving compatibility with existing clients. The server checks the revision under the existing tenant-scoped row lock. Assignment and control actions from this UI also send the revision. A conflicting edit keeps the draft and offers the latest note as its base.

## Follow-ups

Staff can save, edit or clear a private follow-up timestamp and note on the existing conversation. The editor explicitly shows the device timezone and converts local input to UTC. Unsaved changes survive conversation switches in tab memory; a conflicting revision preserves the draft and offers the current revision for a reviewed retry. Timestamp/note validation and tenant checks run on the server. Notes are not included in audit metadata or sent to customers.

Saved follow-ups survive reload through existing JSON persistence; this additive API change needs no database migration. No scheduled background notification, push message or automatic customer message is created. Recurring CRM task/reminder workflows remain T-034.

## Customer and order context

A Meta sender ID is not a CRM contact UUID. The conversation stores its CRM customer (`contactId`, T-088), so every member sees the same link. It is set when the customer sends a phone number (one customer per phone in the business, created when missing), when a website visitor leaves one, or by staff, who search and select a profile and can change or remove the link (`contacts.edit`); the UI never matches customers by name. The profile offers "Open in CRM" (`/app/contacts?contact=`), and the CRM profile lists the customer's conversations, each opening `/app/inbox?conversation=`. A selected profile supplies initial details to a new order. An existing draft preserves its original editable customer fields and displays a warning instead of overwriting them when a different profile is selected. The selected profile exposes stage and tag controls directly in the panel using existing permissions and version checks. Full CRM editing and history remain available through the profile drawer.

The order tab reuses the existing commerce form, source-specific field policies, warehouses, product variants, stock warnings and integer money calculations. It creates a real order through the existing endpoint and keeps the operator in the inbox. A draft retains its client request ID and fields across conversation switches; a shared in-flight registry prevents duplicate submission from remounted forms. The awaited completion clears the original draft and records the created order even when the operator has switched away. Embedded F2 applies only with focus inside the visible order form.

Orders shown in the customer panel are explicitly labelled as created during the current inbox session. They are not a purchase history: the existing order contract has no conversation/contact identity link. No customer confirmation message is sent automatically after order creation.

## Limits and follow-ups

- Updates use the existing polling intervals, not realtime transport.
- Attachments use existing HTTPS URL/media-library capabilities; direct uploads are not implemented here.
- Background/recurring notifications, server-shared inbox views and complete historical order linking require their own persistent backend work. Cross-channel identity is only by phone number (T-088). No inactive controls are presented for those capabilities.
- Browser coverage includes filled order panels at 375, 1280 and 1440 pixels, draft switching and consecutive note saves. Component tests cover in-flight completion and duplicate prevention; backend tests cover stale writes and cross-tenant access.

## Review screenshots

Generated from synthetic API fixtures in the production browser suite, not real customer data.

- [Customer context](reference/inbox-redesign/customer-context.png)
- [Desktop order panel](reference/inbox-redesign/desktop-order.png)
- [Mobile order panel](reference/inbox-redesign/mobile-order.png)
- [Expanded order details](reference/inbox-redesign/expanded-order.png)
- [Follow-up editor](reference/inbox-redesign/follow-up.png)
- [Saved views](reference/inbox-redesign/saved-views.png)
