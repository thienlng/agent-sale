# ADR-011: Website chat widget: single Shadow DOM script, polling first

- Status: Accepted (owner, 2026-10-27, approved in chat)
- Date: 2026-10-27
- Decision makers: the product owner approved in chat on 2026-10-27; review by the maintainer (thienlng) is pending

## Context

`docs/07` section 5 planned the website widget as a small loader that opens an iframe bundle, with a WebSocket/SSE connection and long-polling fallback. The website chat channel (CHN-05, T-097..T-104) must work as one pasted line on any shop site (custom HTML, WordPress, LadiPage, Haravan, Sapo, Shopify, Wix, GTM), on old iOS Safari, and plug into the existing inbox pipeline. The `realtime` entry does not exist yet; the `api` entry and the durable queue `channel_webhook_events` do.

## Decision

- **Isolation:** one script that renders inside a **Shadow DOM** root. No iframe, no second request for a bundle.
- **Build:** plain TypeScript, no framework, output **ES2017**, at most **20 KB gzip**; both limits are enforced in CI (size check and `es-check es2017`). The bundle must not include Zod; it imports contract types as types only and reuses the shared phone rules.
- **Transport:** **polling** on the existing `api` entry. Cadence: 3 s while open and awaiting a reply, 4 s while open, 20 s while closed, paused while the page is hidden, exponential backoff to 60 s on errors. No polling before the visitor's first message. SSE on the `realtime` entry is a later task; the API contract leaves room for it.
- **Visitor identity:** an HMAC-signed token `v1.<visitorId>.<base64url(HMAC-SHA256(siteSecret, visitorId))>` created on the visitor's first message, stored in `localStorage`, verified in constant time without a database read. The per-site secret is sealed in `channel_connections.token_sealed`.
- **Surface:** a new `webchat` module serves the public, unauthenticated routes. Access is limited by a site key (not a secret), an `Origin` allowlist (hostnames including subdomains) and per-visitor, per-IP and per-site rate limits. Rate limits are in-memory behind a `RateLimiter` port until a Redis client exists in the backend.
- A website is a `channel_connections` row (`provider: 'website'`) and reuses the inbox processor via channel capabilities; website delivery is local.

## Options considered

1. **Iframe loader + bundle (docs/07 original):** strongest isolation from host JavaScript and CSS, but two requests, a cross-frame page-context channel (`postMessage`), harder mobile keyboard and sizing behavior, and blocked by some builders and CSP setups. Rejected.
2. **Hybrid (Shadow DOM bubble, iframe panel):** isolation benefits remain partial, complexity of both. Rejected.
3. **SSE/WebSocket first:** lower latency, but needs the `realtime` entry, sticky connections and proxy tuning for a first slice; polling load is small and bounded. Deferred, not rejected.

## Consequences

- Shadow DOM isolates CSS only. Host-page JavaScript can still interfere with globals (`Array.prototype`, `fetch`, `JSON`), so the widget code must be defensive, wrap `localStorage` access in try/catch, guard against double inclusion (`window.__rapizWidget`) and attach after `DOMContentLoaded` when loaded in `<head>` or GTM.
- The widget reads page context (URL, title, referrer) directly, with no `postMessage` boundary; the server treats it as untrusted input and bounds its length.
- Polling load per active visitor is about 0.25-0.33 requests/s while a reply is awaited or the panel is open, 0.05 requests/s while closed, and zero while hidden. This must stay within the budgets in `docs/16`; per-IP polling limits (600 per 10 min) apply.
- Clearing browser storage starts a new visitor (accepted trade-off). `Origin` is forgeable outside browsers: it stops other sites embedding a stolen key; abuse is bounded by rate limits.
- The in-memory limiter is per process; with several `api` replicas the effective limits multiply until a shared store replaces the port.
- `docs/07` section 5 is rewritten to match this decision.
