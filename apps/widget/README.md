# @agent-sales/widget

Embeddable website chat widget (T-101): one plain-TypeScript script, Shadow DOM, polling (ADR-011).
Output is ES2017, at most 20 KB gzip; no framework, no zod.

```html
<script src="https://<host>/widget.js?key=<SITE_KEY>" async></script>
```

The site key is read from the script URL (`?key=`). The API origin is the script origin unless
`data-api="https://api.example.com"` is set. API routes: `/api/v1/webchat/v1/sites/{key}/...`.

## Look

The launcher is a 52 px rounded square: the bot's avatar (`config.avatarUrl`) on charcoal, else a
chat icon in the shop colour (`--c`), with a status dot and a "Chat với …" tooltip. The panel
(380 × ≤600 px, 8 px above the launcher, full screen under 640 px) has a header with the avatar, name and "Sẵn sàng hỗ trợ",
the lead strip right under it (a chip opening a form: optional name, then a phone number or an
email in one field; a phone only while the site requires one, `POST …/contact`), the messages (agent bubbles carry the avatar), the composer and a
"Được hỗ trợ bởi Rapiz AI" footer. Sizes are compact on desktop (14 px text in the fields, 30 px
buttons); with a touch screen the fields use 16 px text (iOS does not zoom) and buttons are 44 px. Colours derive from the shop colour; motion is a 200 ms open and
a 150 ms fade on close, none with `prefers-reduced-motion`.

`data-starters="Xem bảng giá|Tìm hiểu tính năng|Đặt lịch demo"` on the script tag shows up to 4
buttons (80 characters each) under the greeting while the visitor has not written; a tap sends
the text.

A card with a `summary` or `highlights` is drawn as a plan card (title, summary, price, up to 3
facts, "Tìm hiểu thêm →", no picture, two per row); `recommended` marks the featured one. Other
cards keep the picture carousel.

## Page context

Each message tells the bot what the visitor has on screen, but only parts of the page the site
marked (nothing else is read):

```html
<section data-rapiz-section="Bảng giá">
  <article data-rapiz-section="Gói Growth" data-rapiz-context="Gói Growth 400.000đ/tháng, 3 kênh">
    …
  </article>
</section>
```

`src/page-context.ts` sends at most 3 visible marked elements, innermost first (a section only
fills the slots its visible marked children leave), each ordered by visible area: the name from
`data-rapiz-section` (80 characters) and the text from `data-rapiz-context`, else the element's
visible text (400 characters). Keep summaries short and factual; the bot treats them as visitor
data and still takes prices from its knowledge.

## Commands

```bash
pnpm --filter @agent-sales/widget test       # vitest + jsdom
pnpm --filter @agent-sales/widget build      # esbuild -> dist/widget.js, then es-check es2017 and the gzip budget
```

## Try it locally

1. Run the API (`pnpm --filter @agent-sales/backend dev`) and create a Website channel in the dashboard
   with `localhost` in its allowed domains; copy the site key.
2. `pnpm --filter @agent-sales/widget build`.
3. Put the key in `dev/index.html`, serve the folder (for example `npx serve apps/widget` and open
   `/dev/`). `data-api` points the widget at the local API.

## End-to-end

`apps/web/e2e/website-chat.spec.ts` loads the built `dist/widget.js` on a static host page with the `/api/v1/webchat/v1/...` routes mocked, together with the dashboard inbox (builds the widget first when `dist/` is missing).

## Notes

- `src/types.ts` mirrors `packages/contracts/src/webchat`; keep both in sync.
- Server and visitor text is rendered with `textContent` only.
- Not yet handled: dashboard preview mode (`key=preview`), proactive invites, SSE.
