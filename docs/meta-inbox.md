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

## Inbox v2 data and API (T-073)

Design: `docs/superpowers/specs/2026-10-25-inbox-v2-design.md`. A conversation is still one `data jsonb` document, plus index columns derived from it on every save (migration `0024_inbox_v2.sql`): `unread_count`, `awaiting_since`, `last_read_at`, `assignee_id`, `mode`, `status`, `customer_phone`, `created_at`. The list filters, counts and sorts in SQL on those columns.

| Field | Meaning |
|---|---|
| `unreadCount`, `lastReadAt`, `lastReadBy` | Read state **shared by the whole shop**. A customer message adds one; `POST /conversations/{id}/read` clears it and records who; `POST /conversations/{id}/unread` sets it to at least 1 and forgets the reader. Neither bumps `revision` or `updatedAt`, so a pending bot reply stays valid and the list does not reorder. |
| `awaitingSince`, `lastMessageSender` | "Customer is waiting": set by a customer message while null (to the message time), cleared by any outbound message (staff in the app, staff on the page, or the bot). A reply that fails to send restores it. |
| `customerPhone` | Last Vietnamese mobile number found in a customer message (`0xxxxxxxxx`, `+84…`, `84…`; spaces, dots and dashes tolerated; landlines ignored). |
| `notes[]` | Internal notes timeline (author, time, text; at most 200, oldest dropped). `POST /conversations/{id}/notes`. The legacy `note` string is migrated as the first entry and mirrors the newest note. |
| `assigneeId` | `PATCH /conversations/{id}` accepts any active member (checked through `TeamFacade`) or `null`; `assignToMe` still works. |

`GET /conversations` query: `tab` (`all|unread|waiting`), `assignee` (`me|none|<uuid>`), `channelId`, `hasPhone`, `waiting` (`any|longest|readNotReplied`), `status`, `mode`, `provider`, `q` (name, phone, customer id, last message), `sort` (`recent|waitingLongest`), `limit`. The response carries `counts: { all, unread, waiting }` computed with every filter except `tab`.

Backfill of existing rows: columns come from the document; `awaiting_since` is the first customer message after the last outbound one for open conversations whose newest message is the customer's; `unread_count` starts at 0 (no history of who read what); `customer_phone` starts empty and fills from new messages.

### Customer profile lookup

After a customer message the agent asks the channel module for the customer's name and picture (`ChannelFacade.fetchCustomerProfile`; the page token never leaves the channel module). Messenger: `GET graph.facebook.com/{version}/{psid}?fields=first_name,last_name,profile_pic`; Instagram: `GET graph.instagram.com/{version}/{igsid}?fields=name,username,profile_pic`, both with the token in the `Authorization` header (Meta Graph API, User Profile API for Messenger / Instagram messaging; endpoints taken from the Meta developer docs, not re-verified against a live page on 2026-10-25). The call runs after the message is stored and is not awaited by the reply pipeline. The attempt is stamped in `profileFetchedAt` before the call, so a missing permission or a customer Meta refuses to describe costs at most one request a day; a success is refreshed daily as well because Meta picture URLs expire. Failures are ignored and never logged with the customer id. The conversation's `revision` and `updatedAt` do not change.

## Limits

- Outbound attachments are sent by HTTPS URL (bot image library or a pasted link); there is no file upload to Meta.
- Meta CDN attachment URLs expire; the inbox shows them as received and falls back to a link.
- A customer's name and picture come from a best-effort profile lookup (below); until it succeeds, `customerName` is the Meta-scoped id and the UI shows a masked label.
