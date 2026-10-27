# @agent-sales/widget

Embeddable website chat widget (T-101): one plain-TypeScript script, Shadow DOM, polling (ADR-011).
Output is ES2017, at most 20 KB gzip; no framework, no zod.

```html
<script src="https://<host>/widget.js?key=<SITE_KEY>" async></script>
```

The site key is read from the script URL (`?key=`). The API origin is the script origin unless
`data-api="https://api.example.com"` is set. API routes: `/api/v1/webchat/v1/sites/{key}/...`.

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
