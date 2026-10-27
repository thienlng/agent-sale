# Website chat channel (core + lead capture) — design

Status: approved by the owner in chat on 2026-10-27 (scope, ownership, isolation, transport, lead destination, notifications, pipeline approach A, sections 1–4). Section 5 (leads) and testing were folded into this document at the owner's request.

Functional reference: khach.me (analysed 2026-10-27; their `widget.js` was read for behaviour, not copied). Product requirement: `docs/02` CHN-05, WEB-06. Channel design: `docs/07` §5 (this spec deviates from it on isolation, see ADR below).

## Goal

A shop pastes one line on its website and gets a chat bubble that behaves like any other Rapiz channel: the bot answers from the same knowledge, staff take over from the same inbox, and a visitor who leaves a phone number becomes a CRM customer.

```html
<!-- host is an example; final CDN host is decided at deploy time -->
<script src="https://widget.rapiz.vn/v1/widget.js?key=wk_XXXXXXXXXXXXXXXXXXXXXX" async></script>
```

## Decisions (owner)

| Topic | Decision |
|---|---|
| Scope of this spec | Core channel + lead capture. Proactive invites, attribution/CAPI, funnel/goals, proof-of-work, branding line and WordPress plugin are later specs (see Roadmap). |
| Ownership | A website is a `channel_connections` row (workspace + `bot_id`), exactly like a Facebook Page. It moves with Pages when the shop milestone lands (T-082). |
| Isolation | **Shadow DOM** in a single script, not the iframe described in `docs/07` §5 → needs an ADR. |
| Transport | **Polling** on the existing `api` entry. SSE on the `realtime` entry is a later task; the API contract leaves room for it. |
| Lead destination | Upsert a CRM contact immediately (source `website`), link it to the conversation. T-088 generalises the link later. |
| Notifications | In-app only: "Số mới" badge in the inbox, sound + browser `Notification` while the dashboard tab is open. Web Push is a later task. |
| Pipeline | **Approach A**: reuse `channel_webhook_events` and the inbox processor, generalised by channel capabilities. Rejected: synchronous inference in the API (breaks "API never starts inference", no burst merge/retry) and a separate website processor (duplicates reply logic). |

## Architecture

```
Shop website                          Rapiz
┌──────────────────┐  GET  /webchat/v1/sites/:key            ┌─ api entry ────────────────────────────┐
│ widget.js        │ ──────────────────────────────────────▶ │ webchat module (public, no login)      │
│ Shadow DOM       │  POST /webchat/v1/sites/:key/messages   │  site key → connection (system role)   │
│ localStorage:    │ ──────────────────────────────────────▶ │  Origin ∈ site domains                 │
│  visitor token   │  GET  …/messages?after=<id>             │  rate limits (Redis)                   │
│                  │ ◀────────────────────────────────────── │  write event → channel_webhook_events  │
│                  │  POST …/uploads   POST …/phone          │  reads via conversation facade         │
└──────────────────┘                                         │  phone → crm facade                    │
                                                             └───────────────┬────────────────────────┘
                                                                             │ durable queue (exists)
                                                             ┌─ agent entry ─▼────────────────────────┐
                                                             │ InboxProcessor (generalised)           │
                                                             │  receive → AI → deliver()              │
                                                             │  website deliver = mark sent locally   │
                                                             └────────────────────────────────────────┘
```

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `apps/widget` (new) | Plain TypeScript, no framework, Shadow DOM. Built to **ES2017** (no lookbehind, no optional chaining in output) for old iOS Safari. Budget **≤ 20 KB gzip**, enforced in CI. Output `widget.js`. | `packages/shared` (phone normalisation only) |
| `modules/webchat` (new, `pnpm gen module webchat`) | Public widget API, visitor tokens, origin check, rate limits, uploads, lead capture orchestration. Owns `webchat_visitors`. | `channel`, `conversation`, `crm` facades |
| `modules/channel` | Provider `website`: create/update/disable a site, generate site key and signing secret, settings. `deliver()` / `presence()` dispatch by provider. | — |
| `modules/conversation` | `MetaInboxProcessor` → `InboxProcessor` driven by `ChannelCapabilities`; window check in `send()` by capability; `listForVisitor`; `linkContact`. | `channel`, `ai`, `bot` facades |
| `modules/crm` | Facade `upsertLeadByPhone`. | — |
| `packages/channels` | `website.ts` adapter: `capabilities()` = `{ richCards: false, quickReplies: true, media: true, replyWindowHours: null }`; `send` is not used (delivery is local). | — |
| `packages/contracts` | `WebsiteSettings`, public widget DTOs, `ConversationDto.lead`. | — |
| `apps/web` features/channel + conversation | Enable the Website card; site form, embed code, live preview; lead badge and notifications in the inbox. | — |

`webchat` is separate from `channel` because it is the only surface that accepts unauthenticated internet traffic; its security rules stay in one place and out of the dashboard API.

## Data model

### `channel_connections` (existing, one row per website)

| Column | Website value |
|---|---|
| `provider` | `'website'` |
| `external_id` | Public site key `wk_` + 22 base62 chars (not a secret). |
| `token_sealed` | Per-site 32-byte HMAC secret, sealed with `SECRETS_ENCRYPTION_KEY`; signs visitor tokens; never leaves the module. |
| `bot_id` | Bot that answers, bound like a Page. |
| `status` | `connected` (on) / `disabled` (off). |
| `settings` **(new, `jsonb`, nullable)** | `WebsiteSettings` (Zod, `packages/contracts`): `domains: string[]` (1–10 hostnames, subdomains included), `color` (hex), `position: 'left' \| 'right'`, `agentName`, `avatarUrl?`, `greeting`, `phonePrompt`, `phoneChipText`, `requirePhoneAfter` (customer messages before the phone is required; `0` = never). |

Migration: add one nullable column. No change for existing Page rows.

### `webchat_visitors` (new, owned by `webchat`, tenant RLS via `tenantPolicies`)

`id (uuid v7), workspace_id, connection_id, conversation_id, first_url (≤1000), referrer (≤500), last_url (≤500), last_title (≤150), phone_e164, contact_id, phone_captured_at, created_at, last_seen_at`

- A row is created on the visitor's **first message**, never on page view.
- No raw IP or user agent is stored. IPs are hashed and used only as Redis rate-limit keys with TTL.
- `first_url` keeps UTM/click ids for the attribution spec.

### Visitor identity

- On the first `POST /messages` without a token the server creates the visitor and returns `v1.<visitorId>.<base64url(HMAC-SHA256(siteSecret, visitorId))>`.
- The widget stores it in `localStorage` under `rapiz_v_<siteKey>` and sends it as `Authorization: Visitor <token>`. Verification is a constant-time HMAC check; no DB read.
- The conversation's `customer_id` is the `visitorId`; the existing unique `(workspace, channel, customer)` holds.
- Cleared storage = new visitor (accepted trade-off).

### Messages on the queue

- The widget generates `clientMessageId` (UUID) per message; it becomes the event's `external_id`, so a network retry is deduplicated by the existing `(connection_id, external_id)` unique index.
- Payload is a `NormalizedEvent`: `kind: 'website'`, `assetExternalId: siteKey`, `senderExternalId: visitorId`, `type: 'message'`, text **or** one image attachment.
- Customer images are compressed in the browser, uploaded via `/uploads` to the existing S3 storage (same infrastructure as `s3-bot-media-storage.ts`), and referenced by HTTPS URL.

### What the visitor sees (`listForVisitor`)

Customer messages and bot/staff messages with status `sent`. Never internal notes, failed/unknown messages, or staff identities: staff messages are shown under `settings.agentName`.

## Public widget API

Base `/webchat/v1/sites/:key`, served by the `api` entry. Contracts in `packages/contracts/src/webchat/`.

| Route | Purpose | Response |
|---|---|---|
| `GET /` | Public settings: color, position, agentName, avatarUrl, greeting, phonePrompt, phoneChipText | 200 settings (never `domains`, `bot_id`); cached 60 s server-side |
| `POST /messages` | `{ clientMessageId, text? , attachmentUrl?, page: { url, title }, firstUrl?, referrer? }` | 202 `{ visitorToken, message }` |
| `GET /messages?after=<messageId>` | Poll | 200 `{ messages, botTyping, phoneCaptured, phoneRequired }` |
| `POST /uploads` | One image, ≤ 5 MB, MIME checked by magic bytes | 200 `{ url }` |
| `POST /phone` | `{ phone }` | 200 `{ phoneCaptured: true }` / 422 `INVALID_PHONE` |

- `botTyping` is true while the visitor has an unprocessed event in the queue (one indexed query through the channel facade).
- `after` is the last message id (UUIDv7, monotonic), so no message is skipped.

### Origin and site state

- `Origin` must match a hostname in `settings.domains` (exact or subdomain). CORS echoes that origin; no credentials/cookies.
- Unknown key, disabled site or origin mismatch → `404`; the widget then **does not render** (so nobody leaves a phone number into a dead site). Network errors and `5xx` → the widget renders with defaults and retries sends.
- `Origin` is forgeable outside browsers: it stops other sites from embedding a stolen key; abuse is handled by rate limits.

### Rate limits (Redis, sliding window)

| Key | Limit |
|---|---|
| Visitor | burst 5 then 1 msg/s; 60 msgs/h; 10 uploads/h |
| Hashed IP | 30 msgs/10 min; 600 polls/10 min |
| Site | 120 new visitors/min |
| Message | ≤ 2,000 characters |

Exceeded → `429` with `Retry-After`; the widget shows a polite Vietnamese notice.

### Quota

Website replies consume the same AI quota as other channels (quota ownership is T-091, unchanged here). Bot off or quota exhausted → the conversation goes to staff; the widget keeps working.

## Pipeline changes (no behaviour change for Meta)

| # | Meta assumption today | Change |
|---|---|---|
| 1 | `MetaInboxProcessor` skips events older than `MESSAGING_WINDOW_MS` (24 h) | Rename to `InboxProcessor`; read `replyWindowHours` from the channel's capabilities; `null` = no window. |
| 2 | `conversation.send()` rejects staff sends after 24 h (`conversation.facade.impl.ts` window check) | Same capability lookup. Staff can answer a website visitor days later; the visitor sees it on return. |
| 3 | `channel.deliver()` / `presence()` always build a `MetaAdapter` | Dispatch by provider. Website `deliver()` returns `{ status: 'sent', externalId: <message id> }` without a network call; `presence()` is a no-op. |
| 4 | Types `PendingMetaEvent`, `MetaProvider` | Rename to `PendingInboxEvent`, `ChannelProvider = MetaProvider \| 'website'`. Pure rename. |

Reused unchanged for the website: burst merge, retry 20 s / 60 s then handoff, dead letters, staff takeover pauses the bot (and drops a stale bot reply), reply splitting, bot images (max 3), customer image vision. `SafeImageFetcher` adds the Rapiz upload host to its allowlist.

Delivery: items 1–4 land as **one refactor commit with no feature change**; the existing Meta test suite must pass **without editing any test**. Website behaviour follows in later commits.

## Lead capture

### Phone normalisation (one rule, two places)

- Extend `packages/shared/src/phone.ts`: `normalizeVnPhone` additionally maps legacy 11-digit prefixes (0168 → 038, …) and rejects placeholder numbers (`0987654321`, `0123456789`, `0909090909`, `0912345678`, `0000000000`, `1234567890`); new `findVnPhone(text)` extracts the first valid mobile number from free text (`+84`, `84`, spaces, dots, dashes).
- The widget imports the **same** module (bundled), so the browser never accepts a number the server rejects.

### Capture paths

1. **Phone chip**: after the first bot reply the widget shows `phoneChipText`; tapping it switches the input to phone mode → `POST /phone`.
2. **Number typed in chat**: `POST /messages` runs `findVnPhone(text)`; a hit captures the lead in the same request. The message is still sent normally.
3. **Required phone**: when `requirePhoneAfter > 0` and the visitor has sent that many messages without a phone, the poll returns `phoneRequired: true`; the widget switches to phone-only input; the server rejects further text with `409 PHONE_REQUIRED` until a phone is captured.

### What capture does (webchat module, one request)

1. Normalise; invalid → 422.
2. `crm.upsertLeadByPhone(ws, { phoneE164, sourceKey: 'website', firstUrl, conversationId })`: find the contact by normalised phone in the workspace, else create it (name `Khách website <last 4 digits>`). Existing contacts keep their first source (CRM invariant); a history entry records the website capture. Idempotent under retry and race (per-phone advisory lock or unique-violation retry).
3. Store `phone_e164`, `contact_id`, `phone_captured_at` on the visitor.
4. `conversation.linkContact(ws, conversationId, contactId, { phoneE164, capturedAt })` sets `lead` on the conversation (`ConversationDto.lead`).
5. The bot's reply context gets a short system line that the phone is already known, so it stops asking.

A changed number from the same visitor updates the visitor and links the new contact; the old contact is not modified.

### Staff side

- Website conversations appear in the shared inbox with the Website icon (`platform-icon.tsx` already has it); staff reply as with Messenger.
- The conversation side panel shows first URL, current page, referrer and phone (from `webchat_visitors`, through a webchat facade query).
- A conversation with `lead` and not yet seen by staff shows a **"Số mới"** badge. When the inbox list refresh (existing `refetchInterval`) brings a new lead, the dashboard plays a sound and shows a browser `Notification` (permission requested once from the inbox).

## Widget behaviour (core)

- Loads, then makes **one** request (`GET /`); no polling until the visitor's first message.
- Polling: 3 s while open and awaiting a reply, 4 s open, 20 s closed; paused while `document.hidden`; exponential backoff to 60 s on errors.
- Bubble button (color, left/right), unread count, panel with agent name/avatar, greeting as the first bubble (client-side only until the first message, then sent with it so staff see what the visitor read), text input, image button, phone chip, typing dots from `botTyping`.
- Mobile: full-height panel, input kept above the keyboard with `visualViewport`; no zoom lock (WCAG 2.1 AA, `docs/02`).
- Respects `prefers-reduced-motion`; strings follow the bound bot's language (Vietnamese default, English when the bot language is `en`).
- Guard against double inclusion (`window.__rapizWidget`); attaches after `DOMContentLoaded` if loaded in `<head>`/GTM.
- `localStorage` access wrapped in try/catch; without storage the widget works for the page session only.

## Dashboard (apps/web)

- Integrations page: enable the Website card. "Add website": name, domains, bot. Card shows status (on/off) and actions: copy embed code, settings, disable.
- Settings form for `WebsiteSettings` with a live preview: the dashboard mounts the widget bundle with the unsaved settings passed in-page (`key=preview`), which makes no API calls and stores nothing.
- Install guide: snippet + short instructions for custom HTML, WordPress, LadiPage, Haravan, Sapo, Shopify, Wix, GTM (static copy).

## Error handling summary

| Situation | Behaviour |
|---|---|
| Site unknown / disabled / origin mismatch | 404, widget not rendered |
| API 5xx / offline | Widget renders; outgoing messages kept and retried with the same `clientMessageId` |
| Rate limited | 429 + `Retry-After`; polite notice |
| Bad visitor token | 401; widget drops the token and starts as a new visitor on next send |
| AI failure | Existing retry then handoff to staff; visitor sees the bot's handoff message |
| Invalid phone | 422; inline Vietnamese error, input kept |

## Testing

- **Unit**: visitor token sign/verify (tamper, wrong site), origin matcher (subdomain, port, case), settings schema, `findVnPhone`/`normalizeVnPhone` table tests (shared by widget and server), rate limiter windows, capability-driven window check.
- **Regression**: entire existing Meta inbox/channel suite unchanged and green after the refactor commit.
- **Integration (DB)**: send → event row → `InboxProcessor.tick()` with a fake AI → reply visible via poll; duplicate `clientMessageId` stored once; staff send after 48 h succeeds for website and still fails for Meta; phone capture creates one contact under concurrent requests; RLS: visitor rows invisible across workspaces; disabled site → 404.
- **Widget**: Vitest + jsdom for the state machine (closed/open/awaiting/phone mode/required phone), polling cadence and pause on hidden.
- **E2E (Playwright)**: a static host page embeds the widget against the local API; visitor chats, bot answers, staff takes over from the inbox, visitor sees the staff reply; visitor leaves a phone, the contact appears in the CRM and the inbox shows "Số mới".
- **CI gates**: widget bundle ≤ 20 KB gzip; output syntax ES2017 (`es-check`).

## Docs and decisions to update in the same PR

- New ADR: widget isolation by Shadow DOM, polling first (deviates from `docs/07` §5).
- `docs/07` §5, `docs/04` (public widget surface), `docs/05` (`settings`, `webchat_visitors`), `docs/09` (visitor token, rate limits, no IP storage), `docs/03` (widget route), module `MODULE.md` files (channel, conversation, crm, new webchat), `docs/meta-inbox.md` (processor rename).

## Proposed tasks (one milestone, one branch, one commit per task)

1. ADR + docs/07 update — widget isolation and transport.
2. Generalise the inbox pipeline (rename + capabilities + deliver dispatch), no behaviour change.
3. Website connection: `settings` column, channel facade CRUD, site key/secret, dashboard card, settings form, embed code.
4. `webchat` module: public API, visitor tokens, origin check, rate limits, uploads, `listForVisitor`, `botTyping`.
5. `apps/widget`: bubble, panel, polling, images, mobile handling, CI size/syntax gates.
6. Lead capture: shared phone rules, `upsertLeadByPhone`, `linkContact`, required-phone mode, inbox badge and notifications.
7. E2E suite and docs pass.

## Roadmap after this spec (separate specs)

1. Proactive: delayed greeting bubble, invite triggers (time / scroll / exit intent), per-campaign greeting by URL match, business-hours greeting.
2. Attribution: page journey kept client-side and sent with the first message, UTM/click ids, current page passed to the bot, Meta Conversions API Lead with `_fbp`/`_fbc`.
3. Funnel and goals, proof-of-work anti-spam, install health ("no ping for 24 h"), "Vận hành bởi Rapiz" line on the Free plan, WordPress plugin, SSE transport, Web Push.

## Out of scope

Everything in the roadmap above; plan entitlements for the website channel (pending `docs/14` A5 and T-091); file attachments other than images; visitor-side message history across devices.
