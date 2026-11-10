# ADR-029: Rich messages in the website widget (product cards and suggested next steps)

- Status: Proposed
- Date: 2026-11-10
- Decision makers: thienlng (owner request and design answers in chat, 2026-11-10)

## Context

On the website the bot could only answer in text and pictures. A visitor asking "which plans do you
have?" got a paragraph, and the bot could not point to the pricing section or the contact page the
visitor was already a click away from. The widget is the place we show what Rapiz can do, so the
owner asked for interactive pieces inside the chat: product cards to tap, and follow-up buttons with
an arrow ("Xem bảng giá →"), the places found by the bot on the page itself, on any customer site,
without setup. Cards are products only (no free links on a card); tapping one asks about it.

Constraints: the model must not invent prices, pictures or URLs; a page can lie (its text is
untrusted, ADR on the page context); the widget stays plain TypeScript, ES2017, ≤ 20 KB gzip
(ADR-011); Messenger and Instagram keep their own delivery.

## Decision

1. **One optional `ui` on a message.** `MessageUi {cards?: MessageCard[] ≤6, suggestions?:
   MessageSuggestion[] ≤4}` in `packages/contracts/src/conversation/message-ui.schema.ts`. A card is
   `{productId, title, price, imageUrl|null}`; a suggestion is `{kind: 'reply', text}` or
   `{kind: 'link', title, url}`. It is stored in the existing `conversation_messages.data` jsonb (no
   migration), only for bot messages of a `website` conversation, and returned by the widget poll
   (`WidgetMessageDto.ui`) and the inbox (`InboxMessageDto.ui`, shown read-only).
2. **Two website-only tools, ids in, server-built out.** Offered only on a website turn with a page
   context (`website-page@2`), never on Messenger, Instagram or comment replies:
   - `show_products {text, productIds 1..6}` sends at once, through the turn's `MessageSink`, one
     message with the text and cards built from catalog data the turn has seen (focus products and
     every product a catalog tool returned): name, price line (one price, "Từ / From" a range
     start, or the offering's price note) and the first allowlisted picture. Unknown ids are
     reported back; with none known, nothing is sent.
   - `suggest_next {replies? ≤3, links? ≤2 {id, title}}` keeps up to 4 buttons, replies first,
     for the final answer; a later call replaces an earlier one. They are attached to the last
     bubble of the final message only when the turn is answered without a guardrail (never on a
     fallback or a hand-off).
3. **Places come from the page, checked by the server.** With every send the widget reports
   `page.nav` (≤ 24 `{label ≤80, url ≤1000}`): the page's sections (`section[id]` and elements
   marked `data-rapiz-section`, labelled by `data-rapiz-label`, `aria-label` or the first heading)
   and the same-site links of `header`, `nav` and `footer`. `navTargets` keeps http(s) targets on
   the page's own origin, drops the query (it can carry the visitor's data), drops the page itself
   without a fragment and duplicates, and numbers them `n1…`. The model sees `{id, label, path,
   here}` inside `<visitor_page>` and passes ids only; the stored URL is the server's.
4. **The widget renders and acts.** Cards are a scroll-snap carousel (lazy image fading in over a
   tinted initial, title, price, "Tìm hiểu thêm →"); a tap sends "Cho mình tìm hiểu thêm về
   <title>" as the visitor. Suggestions show under the newest message only while it is an answer
   and the bot is not typing. A reply is sent as the visitor; a link to a section of the same page
   scrolls to it smoothly (instant with reduced motion) and rings it once in the site's colour,
   closing the full-screen panel on phones; another page is opened with `location.assign`, after a
   flag that reopens the panel there within 30 s. A `#name` that only a `data-rapiz-section`
   carries is scrolled to on load.

## Consequences

- No schema migration; older messages and other channels have no `ui` and render as before.
- The website prompt changes (`website-page@1` → `@2`); the tool list changes for website turns only.
- A site without sections or navigation links simply gets no link suggestions; replies still work.
- The idempotency check of a bot reply does not compare `ui` (a retry with the same key is the same
  message).
- Quick replies of an order summary are still delivery-only and not shown in the widget; a later
  change can map them onto `suggestions`.
- Bundle: the widget grows from ~10 KB to ~12.7 KB gzip, still under the 20 KB budget.

## Alternatives considered

- **Model-written cards or URLs:** rejected; prices and links must come from data we hold.
- **Links configured per site in the dashboard:** rejected by the owner; discovery works on any site
  without setup, and owners who want better labels can mark sections.
- **Cards with their own links to product pages:** rejected by the owner; a card continues the
  conversation instead.
