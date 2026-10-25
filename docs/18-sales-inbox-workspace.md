# Sales inbox workspace

The inbox at `/app/inbox` keeps the conversation visible alongside customer context and commerce order creation. The route composes the conversation, CRM and commerce features; features do not import one another.

## Queues and filters

The left column provides all conversations, staff handling, assigned to me, unassigned and AI handling queues. Counts refer to the latest loaded results (at most 100), not workspace totals. Page/account, provider, status and reply mode filters apply before queue counts. The staff queue describes ownership mode: it does not claim that the latest message is unanswered. The API currently does not expose unread state or the last sender in the list DTO.

## Conversation work

The customer panel can be collapsed on desktop to widen the thread. The header shows the reply owner mode, resolution status and any automatic AI resume time. Staff can take over, resume an active bound bot, resolve/reopen a conversation, or search the loaded messages. Search covers the current API result, not archived history. New arrivals do not interrupt an operator reading older messages; the jump-to-latest action uses message identity so a full 200-message window still detects arrivals.

The composer has separate customer reply and internal note modes. Quick replies insert at the selection instead of replacing the draft. Attachments are previewed and explicitly sent separately from text, matching the current outbound API contract. Sending restrictions apply to outbound customer messages; notes and order creation remain available.

Text, attachment and internal-note drafts are scoped by user, workspace and conversation and kept in tab memory. They survive switching customers and update when an in-flight send finishes after switching away and back. Reloading or closing the tab discards drafts. A definitive failed send can be explicitly retried with a new idempotency key. An unconfirmed transport failure reuses the original key; pending/unknown outcomes are shown without automatic duplicate sending.

Internal notes append to the conversation's shared note with a captured `expectedRevision`. The optional nonnegative revision on conversation PATCH rejects stale writes with `CONFLICT` while preserving compatibility with existing clients. The server checks the revision under the existing tenant-scoped row lock. Assignment and control actions from this UI also send the revision. A conflicting edit keeps the draft and offers the latest note as its base.

## Customer and order context

A Meta sender ID is not a CRM contact UUID. Staff explicitly search and select a CRM profile; the UI never automatically matches customers by name. A selected profile supplies initial details to a new order. An existing draft preserves its original editable customer fields and displays a warning instead of overwriting them when a different profile is selected. Full CRM editing, tags and history remain available through the profile drawer.

The order tab reuses the existing commerce form, source-specific field policies, warehouses, product variants, stock warnings and integer money calculations. It creates a real order through the existing endpoint and keeps the operator in the inbox. A draft retains its client request ID and fields across conversation switches; a shared in-flight registry prevents duplicate submission from remounted forms. The awaited completion clears the original draft and records the created order even when the operator has switched away. Embedded F2 applies only with focus inside the visible order form.

Orders shown in the customer panel are explicitly labelled as created during the current inbox session. They are not a purchase history: the existing order contract has no conversation/contact identity link. No customer confirmation message is sent automatically after order creation.

## Limits and follow-ups

- Updates use the existing polling intervals, not realtime transport.
- Attachments use existing HTTPS URL/media-library capabilities; direct uploads are not implemented here.
- Follow-up reminders, saved inbox filters, cross-channel identity linking and complete historical order linking require their own persistent backend work. No inactive controls are presented for those capabilities.
- Browser coverage includes filled order panels at 375, 1280 and 1440 pixels, draft switching and consecutive note saves. Component tests cover in-flight completion and duplicate prevention; backend tests cover stale writes and cross-tenant access.

## Review screenshots

Generated from synthetic API fixtures in the production browser suite, not real customer data.

- [Customer context](reference/inbox-redesign/customer-context.png)
- [Desktop order panel](reference/inbox-redesign/desktop-order.png)
- [Mobile order panel](reference/inbox-redesign/mobile-order.png)
- [Expanded order details](reference/inbox-redesign/expanded-order.png)
