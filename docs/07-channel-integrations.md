# 07 — Channel & Partner Integrations

> **Warning:** the API terms of Meta, Zalo, TikTok, Lazada, and carriers change frequently. All limits below are **design guidance** and must be checked against the current official documentation before coding each connector (record the link + check date in `docs/integrations/<kenh>.md`).
> Preny references: `08-dashboard-thuc-te/06-tich-hop.md`, `03-kien-truc-cong-nghe/05-tich-hop-va-api.md`.

## 1. Preny's integration catalog and our priorities

| Integration | Preny | Our priority | Notes |
|---|---|---|---|
| Facebook Messenger (Page) | Yes | **P0 – MVP** | Main revenue channel for Vietnamese SMEs |
| Website chat widget | Yes (paid plans) | **P0 – MVP** | Fully under our control, used as the sandbox |
| Zalo OA (chat) | Yes, requires a paid Zalo OA plan | **P0 – MVP** | Mandatory in the Vietnamese market |
| Facebook comments (reply + private reply) | Yes | P1 | |
| Instagram DM | Yes | P1 | Shares the Meta app |
| ZBS/ZNS template messages (Zalo remarketing) | Yes (separate wallet) | P1 | Templates require Zalo approval |
| Facebook Marketing Messages (FMM) | Yes | P2 | Requires an ad account |
| Meta Conversions API (purchase events) | Yes (shown in the IG UI) | P1 | Measures ad effectiveness – a strong selling point |
| Tool Ads – chat-opening JSON (Click-to-Messenger) | Yes | P1 | No API needed, generates JSON |
| TikTok Business Messaging | Yes | P2 | Availability varies by region, needs verification |
| Lazada IM (Seller chat) | Yes (plan-locked) | P2 | Open Platform, requires app approval |
| Shopee chat | Not seen | P3 | Consider as a differentiator |
| Email (SMTP/SES; Gmail OAuth) | Yes | P1 | Domain authenticated with SPF/DKIM/DMARC |
| Google Sheets (export orders in carrier format) | Yes | P1 | |
| Viettel Post | Yes | P1 | |
| SPX Express | Yes | P2 | |
| J&T Express | Yes | P2 | |
| GHN, GHTK | Not seen | **P1** | Large market share among online shops – a differentiator |
| VNPAY | Yes (plan payments) | P0 (billing) | |
| Bank transfer / VietQR auto-reconciliation | Yes (bank transfer) | P0 (billing) | Via bank webhook services (SePay/Casso…) |
| MoMo | Mentioned in articles | P2 | |
| SMS / ZNS via partners | "Coming soon" | P3 | |
| Pancake / Haravan / Sapo / KiotViet | Name mentioned only | P3 | Order/inventory sync — market expansion |
| Public API + Webhooks for customers | Not verified | P2 | Mandatory for the Enterprise plan |

## 2. Common connector contract

Each channel is an adapter implementing an interface in `packages/channels`:

```ts
interface ChannelAdapter {
  kind: 'facebook' | 'instagram' | 'zalo_oa' | 'tiktok' | 'lazada' | 'website' | 'email';
  // Connection
  buildAuthUrl(ctx): Promise<string>;
  handleAuthCallback(ctx, params): Promise<ConnectedAsset[]>;   // multiple pages/OAs
  refreshToken(conn): Promise<TokenSet>;
  revoke(conn): Promise<void>;
  // Inbound
  verifyWebhook(req): boolean;                                   // signature
  parseWebhook(body): NormalizedEvent[];                         // message, echo, read, delivery, postback, comment, referral
  // Outbound
  send(conn, to, payload: OutboundMessage, opts: {idempotencyKey}): Promise<SendResult>;
  capabilities(conn): ChannelCapabilities;                       // rich card? quick reply? media? window rules?
  canSendNow(conn, contactIdentity, purpose): WindowCheck;       // messaging window policy
  // History
  syncHistory?(conn, since: Date): AsyncIterable<NormalizedEvent>;
  // Errors
  mapError(err): { code: ConnectorErrorCode; retryable: boolean; userAction?: 'reauth' | 'fix_template' | 'slow_down' | 'contact_support' };
}
```

`NormalizedEvent` always keeps `external_event_id`, `external_message_id`, `occurred_at`, `raw` (stored as JSONB for 30 days for investigation).

**Errors must come with a user action** (Preny is rated weak here): token expired → banner "Kết nối lại page X" (Reconnect page X); outside the 24h window → "Cần dùng tag/template" (A tag/template is required); template rejected → link to fix it.

## 3. Facebook Messenger & Instagram (Meta)

- One Meta App (Business type). Permissions requiring App Review (verify current names): `pages_messaging`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement` (comments), `instagram_basic`, `instagram_manage_messages`, `business_management`, `ads_read`/`ads_management` (FMM, Tool Ads). **App Review + Business Verification take several weeks — must be submitted in the first sprint.**
- Connection flow: Facebook Login for Business → select page → obtain long-lived Page Access Token → subscribe the page to webhooks `messages, messaging_postbacks, message_echoes, message_reads, message_deliveries, messaging_referrals, feed`.
- Messaging window: free-form replies within 24h of the customer's last message; beyond 24h only valid message tags (e.g. HUMAN_AGENT for staff within 7 days) or opted-in Marketing Messages are allowed. `canSendNow` must block this at the system level — the "24h follow-up" workflow runs inside the window.
- Comments: `feed` webhook → public comment reply + private reply (once per comment) → pull into Messenger (the "proactively message on comment" feature).
- Referral (ads ref / m.me ref) → customer source + ad code.
- Rate limit: outbound queue grouped by `page_id`, with backoff on rate errors.
- Echo: distinguish messages sent by our app (`app_id` in metadata) from messages staff send from the Page Inbox → used for "bot stays silent when a human replies from another platform".
- Old conversation sync: Conversations API from a user-chosen point in time (Preny has a "Đồng bộ" (Sync) screen).
- **Conversions API**: when an order moves to `confirmed/delivered` → send a `Purchase` event (event_id = order id for dedup, with page_id/ctwa/psid per the business messaging spec). P1.

## 4. Zalo OA

- Register an app at Zalo for Developers; OAuth v4 grants OA permissions (short-lived access token + refresh token; the refresh token is single-use → **the new token must be saved immediately within the transaction**, with a per-connection lock during refresh so two workers refreshing at once do not lose the token).
- Webhooks: `user_send_text/image/file/sticker/location`, `oa_send_*` (echo), `user_follow/unfollow`… Verify the mac signature per the documentation.
- Sending policy: consultation messages within a time window after user interaction, with a message count limit; outside the window, transactional/promotional messages or ZNS/ZBS templates must be used (paid, template approval). Preny's UI requires the OA to be on a paid Zalo plan ("Tăng trưởng/Toàn diện" (Growth/Comprehensive)) → show the requirements clearly on the connection screen.
- ZBS/ZNS: template management (sync approval status), send by phone number, status callbacks → `campaign_recipients`. **Debit the wallet only on successful sends** (as Preny publicly states) → hold credit at scheduling time, capture on a successful callback, release on error.

## 5. Website widget (ours)

Decision record: [ADR-011](adr/ADR-011-website-widget-shadow-dom-and-polling.md). Design: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. A website is a `channel_connections` row (`provider: 'website'`, bound to a bot) and reuses the inbox pipeline like a Facebook Page.

- **Embed snippet:** `<script src="https://widget.rapiz.vn/v1/widget.js?key=wk_XXXXXXXXXXXXXXXXXXXXXX" async></script>` (host decided at deploy time). `wk_` + 22 base62 characters is the public site key, not a secret.
- **Isolation:** a single script renders into a Shadow DOM root (no iframe). Plain TypeScript, ES2017 output, at most 20 KB gzip, enforced in CI.
- **Transport:** polling on the `api` entry: 3 s while open and awaiting a reply, 4 s open, 20 s closed, paused while the page is hidden, backoff to 60 s on errors; no polling before the first message. SSE on the `realtime` entry comes later.
- **Visitor identity:** an HMAC-SHA256 signed token (`v1.<visitorId>.<signature>`) created on the first message, kept in `localStorage`, sent as `Authorization: Visitor <token>`. No raw IP or user agent is stored.
- **Public API:** `/api/v1/webchat/v1/sites/{key}` (config), `/messages` (send, poll), `/uploads` (without a visitor token it starts the visitor like the first message and answers `visitorToken`; the optional query parameters `firstUrl`, `referrer`, `pageUrl`, `pageTitle` fill the visitor row), `/phone`; unauthenticated, identified by the site key and the visitor token. Site lookups are cached for 5 s (misses too), so a disabled site or a changed domain list takes effect within 5 s.
- **Domain allowlist:** the request `Origin` must match a hostname in the site's `domains` (1-10, subdomains included). Unknown key, disabled site or origin mismatch returns 404 and the widget does not render. The caller's origin is echoed on every public response, including that 404, so the widget can read the status and stop; preflight passes only for an allowed origin of a live site.
- **Rate limits:** per visitor (burst 5 then 1 message/s, 60 messages/h, 10 uploads/h), per hashed IP (300 site lookups that miss the 5 s cache per 10 min, answered 429 without a DB query, so polls served from the cache are not counted; per site 120 messages and 2,400 polls per 10 min; 60 uploads and 30 phone submissions per hour), per site (120 new visitors/min), messages at most 2,000 characters. In-memory behind a `RateLimiter` port, so limits are per API instance; a shared store comes later (see docs/09). Exceeded returns 429 with `Retry-After`.
- **Disconnecting:** a website disconnected via `PATCH /channels/{id}` cannot be re-enabled with `enabled:true`; create a new website instead.
- **Settings (`WebsiteSettings`):** `domains`, `color`, `position` (left/right), `agentName`, `avatarUrl`, `greeting`, `phonePrompt`, `phoneChipText`, `requirePhoneAfter` (when a visitor without a phone has sent this many messages, the poll answer carries `phoneRequired: true` and the widget shows the phone form instead of the composer and sends are refused with `409 PHONE_REQUIRED` until a number is given; 0 = never).
- **Queue ids:** a visitor message enters `channel_webhook_events` with the external event id `<visitorId>:<clientMessageId>`, so a retry of the same message is accepted without a second row and another visitor reusing a client id cannot suppress it.
- **Lead capture:** a phone number (chip, typed in chat, or required mode) upserts a CRM contact with source `website` and links it to the conversation. Placeholder numbers (`0987654321`, `0912345678`, …) are rejected for leads (`normalizeLeadPhone`); the inbox flags a new lead with "Số mới" until staff open the conversation, and the dashboard can show a browser notification while it is open.
- **Not in this slice:** captcha/proof-of-work, proactive invites, attribution, operating hours, cookie-consent link, SSE, Web Push (later specs).

## 6. TikTok, Lazada (P2)

- TikTok Business Messaging: verify availability in Vietnam, eligible account types, messaging window. Run a 3-day spike before committing.
- Lazada Open Platform: seller app, IM API, sync Lazada orders into the customer profile (high value for marketplace shops).

## 7. Shipping

`CarrierAdapter` interface: `connect(credentials)`, `quoteFee(order)`, `createShipment(order, idempotencyKey)`, `cancel`, `getStatus`, `printLabel`, `parseWebhook`. Statuses are normalized to a common set: `created → picked_up → in_transit → delivering → delivered | failed_delivery → returning → returned | cancelled`.

- Viettel Post: log in with the partner account (Preny uses a username/password form + a note about the COD contract) → obtain a token.
- GHN / GHTK: API token.
- Waybill creation must be idempotent: store `shipment.request_key`; on timeout, **query the status by order code** before retrying (to avoid creating 2 waybills).
- COD reconciliation: import reconciliation file / API → match against `shipments.cod_amount`.

## 8. Payments (our billing)

- VNPAY: create the payment URL, handle IPN (verify checksum, idempotent on `vnp_TxnRef`); the return URL is for display only.
- Bank transfer: generate a VietQR whose description contains the transaction code; webhook from a balance-change monitoring service → automatic matching; admins can also approve manually.
- Every payment → `payments` + `ledger_entries` + activate the subscription/top-up in the same transaction. Issue **e-invoices** via an e-invoice (HĐĐT) provider (P1).

## 9. Google

- Google OAuth: Gmail send (sending email from the shop's mailbox – sensitive scope, requires Google verification) and Sheets (order export).
- Recommendation: email campaigns use **the shop's own sending domain via SES/SMTP** instead of the Gmail API to avoid limits & heavy verification requirements.

## 10. Connector rollout plan

| Step | Work |
|---|---|
| Week 1 | Create the Meta App and Zalo App, apply for Business Verification, prepare Privacy Policy/ToS/Data deletion URL (required by Meta) |
| In parallel | Write adapters + a **real webhook fixture** set (record/replay) to test without real channels |
| Before go-live | Pass Meta App Review; run a 72h soak test on an internal page; per-connector error monitoring |


## Implemented Facebook comment automation (T-069)

Page feed comments have a dedicated flow for post-aware public/private replies, per-post exclusions and explicit keyword moderation. They are not Messenger messages and do not open a messaging window. Configuration, permission expansion, API endpoints, lifecycle behavior and live verification limits: [Facebook comments](integrations/facebook-comments.md).
