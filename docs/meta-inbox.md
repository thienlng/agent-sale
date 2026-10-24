# Meta inbox (Facebook Messenger and Instagram)

Implements CHAT-01 for Facebook Pages and Instagram professional accounts. Other channels in the UI are informational only. Module contracts: `apps/backend/src/modules/channel/MODULE.md`, `apps/backend/src/modules/conversation/MODULE.md`.

## Flow

1. **Connect.** `POST /channels/{provider}/connect` returns a Meta authorize URL (popup). The callback exchanges the code, lists the granted Pages/accounts as a short-lived discovery, and the user selects which to connect and which bot answers. Tokens are sealed; the app subscribes each Page (`messages`, `messaging_postbacks`, `message_echoes`) or Instagram account (`messages`).
2. **Ingest.** `apps/webhook` verifies `X-Hub-Signature-256` on the raw body (`META_APP_SECRET` / `INSTAGRAM_APP_SECRET`), normalizes events (text, HTTPS attachments, echoes) and stores them in `channel_webhook_events`, deduplicated per connection and message id. It never calls an LLM.
3. **Process.** The `agent` entry claims events every second with a lease, persists every receipt, groups a burst per conversation and asks the AI module for one reply to the newest customer text. Attachment-only turns reach the model as `[image]`-style markers.
4. **Deliver.** The reply is reserved (idempotency key `bot:<event id>`), re-checked against takeover and sent outside any database transaction. Staff sends use the same path and pause the bot.

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

## Limits

- Outbound attachments are sent by HTTPS URL (bot image library or a pasted link); there is no file upload to Meta.
- Meta CDN attachment URLs expire; the inbox shows them as received and falls back to a link.
- Customer names are Meta-scoped ids until profile lookup is added.
