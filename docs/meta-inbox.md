# Meta inbox (Facebook Messenger and Instagram)

Implements CHAT-01 for Facebook Pages and Instagram professional accounts. Other channels in the UI are informational only. Module contracts: `apps/backend/src/modules/channel/MODULE.md`, `apps/backend/src/modules/conversation/MODULE.md`.

## Flow

1. **Connect.** `POST /channels/{provider}/connect` returns a Meta authorize URL (popup). The callback exchanges the code, lists the granted Pages/accounts as a short-lived discovery, and the user selects which to connect and which bot answers. Tokens are sealed; the app subscribes each Page (`messages`, `messaging_postbacks`, `message_echoes`) or Instagram account (`messages`).
2. **Ingest.** `apps/webhook` verifies `X-Hub-Signature-256` on the raw body (`META_APP_SECRET` / `INSTAGRAM_APP_SECRET`), normalizes events (text, HTTPS attachments, echoes) and stores them in `channel_webhook_events`, deduplicated per connection and message id. It never calls an LLM.
3. **Process.** The `agent` entry polls every 0.3 s and claims events with a lease once the customer has been quiet for 0.7 s (a burst is answered together; the oldest message waits at most 4 s, `EVENT_QUIET_MS` / `EVENT_MAX_WAIT_MS` in the channel store), persists every receipt, groups a burst per conversation and asks the AI module for one reply. "Newest" and "already answered" are decided by **receipt order** (claim order = the order we stored the messages), never by Meta timestamps, which can disagree with arrival. The model receives the whole conversation in that order, with all consecutive customer messages after the last bot/staff message merged into ONE customer turn (joined by newlines, attachment notes included once); an outbound message of ANY status (sent, failed, pending, unknown) ends the merge, because a failed reply is still an attempt to answer, so earlier messages are never answered again, and a retry of an event whose reply was already attempted is skipped (never answered or sent twice), so one reply answers every question of the burst; the prompt tells it to answer all of them in order; if the customer writes again while the model is generating, the finished answer is dropped and the event is handed back (`requeueEvent`, no attempt spent, at most twice per event) so the next claim answers the whole burst in one reply; a message that still arrives after the answer went out is answered by its own reply, with the earlier reply in context.

   **Bot hand-over (T-053).** When the AI answer is a `handoff` (or a retry-exhausted event, or media the model cannot see), the agent calls `ConversationFacade.handOff`: mode `human` with `autoResumeAt` = now + the bot's takeover window, so the next customer message after the window goes back to the bot (same resume rule as a manual takeover; never resumes when the bot is set not to auto-resume).

   **Chat feel (T-053).** As soon as the bot decides to answer, the agent shows Messenger "seen" then "typing…" (`sender_action`, refreshed every 10 s while the model works; best effort, never retried, never delays the answer). The answer is cut into short bubbles (`conversation/domain/reply-split.ts`: at line breaks and sentence ends, at most 4, wording unchanged; the prompt asks for one idea per line), sent in order with keys `bot:<event id>`, `bot:<event id>:t2`…; remaining bubbles stop when one is not delivered, the customer wrote again, or a human took over. Consecutive bot bubbles are shown back to the model as one assistant turn. A customer message that gets no reply is never silent: the agent logs the reason (takeover, inactive bot, reply hours, re-auth, or a newer message answering for it).
   - **Customer images (vision, T-053).** When `BOT_IMAGE_VISION` is on (default outside production, off in production unless `true`) and the provider is Hermes, the agent downloads the newest 3 image attachments of the pending customer turn and sends them with the turn (`images` on the AI request, last customer message only). The fetcher (`conversation/infrastructure/media/safe-image-fetcher.ts`) accepts https only, hosts `*.fbcdn.net`, `*.cdninstagram.com`, `lookaside.fbsbx.com`, `cdn.fbsbx.com` (Meta hosts; not re-verified live), resolves DNS itself and pins the connection to a public address, never follows redirects, gives up after 5 s, caps 3 MB per image (6 MB total) while streaming, requires an image/jpeg|png|webp content type that matches the magic bytes, never logs URLs or bytes and never stores them. `BOT_IMAGE_EXTRA_HOSTS` (dev/test, ignored in production) exempts listed hosts from the allowlist and address block and allows plain http for them. Any failure degrades to the text-only behaviour below; if the reply with images fails (for example a provider without vision), the turn is retried once text-only when it has text. An image-only turn goes to the model when at least one image was fetched. Images are customer data sent to the model provider: the ChatGPT-plan login behind Hermes is for testing only.
   - **Attachments without vision.** The model does not see media. A text message that comes with media reaches it with an explicit note in the customer turn (for example `[Khách đã gửi kèm 1 ảnh — bạn không xem được hình ảnh, hãy nói rõ và nhờ khách mô tả hoặc nhân viên sẽ xem]`). If the only unanswered customer content is media (image, file, sticker, no text), the bot sends the bot's `handoffMessage` once and switches the conversation to `human` so staff see it; it does not call the model.
4. **Deliver.** The reply is reserved (idempotency key `bot:<event id>`), re-checked against takeover and sent outside any database transaction. Staff sends use the same path and pause the bot.
   - **Bot pictures (T-053).** When the AI reply carries `images` (customer asked to see a product or library picture; max 3, https URLs from our own stored data only), the agent sends them after the text bubbles as ONE album (a single outbound message whose `attachments` array holds every picture, Meta `message.attachments`; a single picture stays a plain image; empty text, sender `bot`), idempotency key `bot:<event id>:img` (`ConversationFacade.commitBotImages`, the same reserve → deliver → record path as the text). They appear in the inbox like any attachment. Pictures are best effort: a failed or unknown send is recorded as its own failed/unknown outbound message and never fails, retries or hands over the event; a takeover, a deactivated bot or a newer customer message after the text skips the album, and a closed 24-hour window skips them (the text would not have gone out either); a replay of the event is skipped before the AI call, and a repeated key returns the stored message, so pictures are never sent twice. Pictures are sent by URL, so Meta fetches them from the shop's own https host: product pictures must stay publicly reachable.

Before generating, the processor checks the bot is active and inside its reply hours (`replySchedule`, Vietnam time); otherwise the message just waits in the inbox for staff.

On failure an event is retried after 20 s and 60 s; after the third attempt the conversation switches to `human` so staff see it. An event that cannot even be stored in a conversation after its last attempt (or whose worker died) is **dead-lettered**: `processed_at` and `failed_at` are set, the payload is kept for replay, and the agent logs an error (UI for dead letters: T-049). While a page awaits re-auth (`reauth_required`), inbound messages are still stored for staff; the bot does not reply until the page is reconnected.

## Configuration

| Variable | Purpose |
|---|---|
| `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` | Facebook Login for Business (Pages) |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Instagram API with Instagram Login |
| `META_GRAPH_VERSION` | Graph API version, e.g. `v24.0` |
| `META_APP_ORIGIN` | Public HTTPS origin of the web app; OAuth popup results are posted only to it |
| `META_OAUTH_REDIRECT_URI` | Optional exact redirect URI registered on the Meta app, with `{provider}`; defaults to `${META_APP_ORIGIN}/api/v1/channels/oauth/{provider}/callback` |
| `META_WEBHOOK_VERIFY_TOKEN` | Token for Meta's webhook verification GET |
| `SECRETS_ENCRYPTION_KEY` | 32-byte base64 key sealing page tokens |
| `APP_ORIGINS` | Must include `META_APP_ORIGIN` for cookie refresh |

## Screens

- **Tích hợp nền tảng** (`/app/channels`): platform list (all, waiting for a bot, Facebook, Instagram; Zalo, Lazada and TikTok marked as coming soon) and the page list with search, select all, assign bot ("Chỉnh sửa"), deactivate ("Hủy kích hoạt" disconnects) and connect. Message sync is not supported and the button is disabled.
- **Bot → Tích hợp** (`/app/bots/{botId}/integrations`): only pages bound to that bot. "Chỉnh sửa" chooses which workspace pages the bot answers; "Hủy kích hoạt" unbinds them (`botId: null`). Pages connected from here are bound to the bot right after selection.
- **Tin nhắn đa kênh** (`/app/inbox`): conversation list with channel filter (Messenger, Instagram), search and newest/oldest sort; thread with takeover controls and attachments.

**Permissions.** When `META_LOGIN_CONFIG_ID` is set, the Facebook Login for Business configuration decides the permissions (the app does not send `scope`, or Meta answers "Invalid Scopes"). The configuration must include `pages_show_list`, `pages_messaging` and `pages_manage_metadata` (`pages_read_engagement` is not needed for messaging and is not requested); a missing one fails the connection and the API log names it. Meta's own error code, subcode and `fbtrace_id` are logged for every rejected Graph call. The Facebook user token is exchanged for a long-lived one before the Page tokens are read, so Pages do not need reconnecting after about an hour.

Register webhooks on the Meta app for object `page` → `${META_APP_ORIGIN}/webhooks/facebook` and object `instagram` → `${META_APP_ORIGIN}/webhooks/instagram`. While the Meta app is in development mode, only people with a role on the app (administrator, developer or tester) can connect and message. Anyone else — or everyone, when Meta has restricted the app (for example an overdue Data Use Checkup or missing privacy policy URL) — sees Facebook's "App not active" page in the login popup; fix it in the Meta App Dashboard, not in code.

## Local live testing

One HTTPS tunnel can serve the whole stack through `scripts/dev-tunnel-proxy.mjs` (port 4000): `/api/*` → API (3000), `/webhooks/*` → webhook ingress (3001), the legacy `/api/channels/oauth/*` redirect → `/api/v1/channels/oauth/*`, everything else → Vite (5180).

```bash
pnpm --filter @agent-sales/backend dev                       # API :3000
cd apps/backend && pnpm exec tsx watch --env-file-if-exists=../../.env src/entries/agent.ts
cd apps/webhook && PORT=3001 pnpm exec tsx watch --env-file-if-exists=../../.env src/main.ts
pnpm --filter @agent-sales/web dev -- --port 5180
node scripts/dev-tunnel-proxy.mjs 4000
cloudflared tunnel --url http://127.0.0.1:4000                # set META_APP_ORIGIN to the printed URL
```

Open the app through the tunnel URL (not `localhost`) so the OAuth popup can return its result.

## Trying the bot end to end on a fresh checkout

1. `cp .env.example .env`, fill the Meta variables above, `SECRETS_ENCRYPTION_KEY` and `HERMES_BRIDGE_KEY` (32+ characters). Database and role names are `rapiz` / `rapiz_tenant` / `rapiz_system`; a database created before the Rapiz rename must be recreated, then `pnpm db:migrate:dev`.
2. Start the API, agent and webhook ingress as in "Local live testing", plus the Hermes bridge (`services/hermes/README.md`).
3. Sign up in the web app, then make that user a platform admin: `pnpm --filter @agent-sales/backend platform-admin grant <email>`.
4. Admin → LLM: add a `hermes` provider (base URL `http://127.0.0.1:8788`, key = `HERMES_BRIDGE_KEY`), press "Đăng nhập ChatGPT" and approve the code, choose a model from the list in each plan's route, and press "Kiểm tra".
5. Create a bot (fill the mission, products, FAQs, situation instructions), connect a Page on Tích hợp, bind it to the bot and turn the bot on. Send a message from an account that has a role on the Meta app.

Images: customers' pictures are read by the model when `BOT_IMAGE_VISION` is on (default outside production), and the bot sends product pictures (up to five https URLs per product) when asked. The ChatGPT-plan sign-in is for testing only and is off in production.

## Limits

- Outbound attachments are sent by HTTPS URL (bot image library, a product's `imageUrls` or a pasted link); there is no file upload to Meta. Product pictures are plain https links entered in the product form (max 5, 2000 characters each); there is no upload or reference to the image library yet.
- Meta CDN attachment URLs expire; the inbox shows them as received and falls back to a link.
- Customer names are Meta-scoped ids until profile lookup is added.
