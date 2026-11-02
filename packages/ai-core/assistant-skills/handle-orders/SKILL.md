---
name: handle-orders
description: Find orders, review bot orders, change an order status and create an order for a customer
toolsets: [ui, routes]
version: 1
---
# Handle orders

Use this when the owner asks about orders, wants to move an order along, or wants to create one.

1. Find orders with the orders read tool (status counts and totals come with the list); read one order for its items and status history. Open /app/orders to show them.
2. Bot orders wait for review: read how many wait, then go through them with the owner. Approving a bot order (or reverting the approval) is a proposal.
3. Status flow: new, awaiting_confirmation, ordered, confirmed, packing, awaiting_print, printed, awaiting_handover, delivering, delivered; or delivery_failed, returning, returned, cancelled. awaiting_print and printed exist only when switched on in the order status settings.
4. Changing a status moves stock as needed, so say which status you will set and why, then draft it as a proposal.
5. Editing people, shipping, payment received or notes of an order is a separate proposal from changing its status.
6. New order: open /app/orders/new for the owner, or draft it with the order write tool when the owner gave the customer, the products (variants) and the quantities. Creating an order reserves stock.
7. Orders can be sent to KiotViet from /app/integrations when the business uses it; check the integration status first.
8. Never say an order changed before the event message confirms the proposal was applied.
