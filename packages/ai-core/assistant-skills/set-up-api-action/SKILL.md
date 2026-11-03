---
name: set-up-api-action
description: Draft a bot API action from pasted API docs or a curl example; it starts disabled and the owner types the key
title: Thiết lập hành động API
description_vi: Soạn hành động API cho bot từ tài liệu hoặc ví dụ curl; bật sau khi chủ shop nhập khoá
toolsets: [routes, ui]
version: 1
---
# Set up a bot API action

Use this when the owner wants the bot to call their own system (order status, stock, booking, loyalty points) and pastes API docs, a curl command or describes an endpoint.

An API action is for data Rapiz does not hold. The bot already does these without one: a hotel bot reads the calendar, quotes from the villa rates and holds a villa itself (the owner reviews holds on /app/bookings); a shop bot reads the products and creates orders. When the owner asks whether the bot can do one of these, say it is built in.

The assistant never fetches a link. When the owner gives only a link, ask them to paste the endpoint's docs or a curl example.

Keys never go through the chat. The owner's message is masked before you see it: a key shows as [secret removed]. Never ask the owner to type a key, token or password in the chat; they type it in the action form. Never repeat, guess or store one.

## 1. Read first

GET /bots/{botId}/actions: the bot's existing actions. Do not draft a duplicate; point at the existing one instead.

## 2. Map the pasted text, field by field

- method: GET, POST, PUT, PATCH or DELETE.
- url: HTTPS only. Each variable part of the path becomes a {param} placeholder, with exactly one path param of the same name.
- params (at most 20): name (letters, digits, _ or -, starting with a letter), type (string, number or boolean), location (path, query, header or body; no body params on GET), required, and description: a customer-facing line that tells the bot what to ask the customer for ("Mã đơn hàng khách nhận được trong tin nhắn xác nhận").
- Header params never use a reserved name (Host, Authorization, Cookie, Content-Type, Content-Length, Accept, Idempotency-Key, Proxy-*, Sec-*) nor the auth header name.
- responses: the success status code and the fields worth reading back to the customer, as dotted paths ("data.status", "items.name"), at most 30, each with a type and a short description.
- auth, read from the masked headers:
  - "Authorization: Bearer [secret removed]" → kind bearer.
  - "X-Api-Key: [secret removed]" (any header carrying a key) → kind api_key with that header name.
  - no credentials → kind none.
  - A key in the query string or the body: tell the owner this action form only sends keys in a header; ask whether their API accepts one.
- requiresConfirm: true for every method other than GET (the bot asks the customer before calling).
- enabled: always false. Never set it true and never include authSecret.
- name and description in Vietnamese; the description says when the bot should call it ("Gọi khi khách hỏi tình trạng đơn hàng và đã cho mã đơn").

## 3. Draft

1. tool_describe POST /bots/{botId}/actions for the exact body schema.
2. tool_call POST /bots/{botId}/actions with the body and a Vietnamese summary. invalid_input comes back with issues: fix them and call again before telling the owner.
3. The proposal card shows the draft; the owner approves it. The action is created disabled and without its key.

## 4. After approval

1. The card's "Mở để nhập khoá" button opens the action. If the owner is not there yet, ui_navigate to /app/bots/{botId}/actions/{actionId}.
2. Spotlight, one at a time and in this order, with one line each:
   - actions.secret: type the key here (skip when auth is none).
   - actions.test: press "Thử gọi" with sample values and check the answer.
   - actions.enabled: turn the action on once the test answer looks right.
3. The test call and turning the action on are the owner's presses, never yours.

## 5. After a test

When the owner pastes the test answer back, tell them which response fields to add in the form (dotted paths). You cannot change an existing action: editing stays in the form, because it can carry the key.
