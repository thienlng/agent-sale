# channel

**Purpose:** Connects Facebook Pages, Instagram professional accounts and website chat widgets to a workspace (Meta OAuth, sealed page tokens, bot binding) and delivers outbound messages through the Meta adapter.

**Owned tables:** `fanpage_settings`, `fanpage_comments` (migration 0024), `channel_connections`, `channel_oauth_flows`, `channel_webhook_events` (schema in `packages/db/src/schema/channel.ts`, migrations 0007/0009/0013, 0033 adds the `removed` status, 0034 makes `(provider, external_id)` unique among live rows only; `settings` jsonb column in 0025).

**Public API (`api/`):**

- `FANPAGE_FACADE` → settings/posts/comments, verified post context, private-reply provenance, staff reply observation and durable actions (T-069).
- `CHANNEL_FACADE` → `getConnection`, `deliver(ws, id, recipient, { text | attachment }, key)`, `fetchCustomerProfile(ws, id, customerExternalId)` (name and avatar via the page token, `null` on any failure), `claimEvents`, `renewEvent`, `releaseEvent`, `completeEvent`, `deadLetterEvent`, `deadLetterExhaustedEvents`
- Website provider (T-099): `createWebsite`, `updateWebsite` (settings merge, `enabled` toggles `connected`/`disabled`), `resolveWebsite(siteKey)` (public lookup, system role), `signVisitorToken` / `verifyVisitorToken`, `enqueueWebsiteEvent` (deduplicated `channel_webhook_events` insert), `hasPendingCustomerEvent`. `external_id` is the public site key `wk_<22 base62>`; `settings` holds `WebsiteSettings` (allowed domains, look, texts). `domain/website-key.ts` has the key, HMAC visitor token (`v1.<visitorId>.<sig>`) and origin matching helpers.
- `unbindBot(ws, botId)` (T-074): clears `bot_id` of every page using a deleted bot; registered on the bot module's `BOT_LIFECYCLE` hook.
- `MAX_EVENT_ATTEMPTS` (3): the store stops claiming an event after this many attempts; an event that ends without completion is dead-lettered (`processed_at` + `failed_at`, payload kept).
- `EVENT_QUIET_MS` (700) and `EVENT_MAX_WAIT_MS` (4000): the quiet window and maximum wait of `claimEvents`; the agent entry uses them to arm the trailing tick after a NOTIFY.
- `remove(ws, id)` (T-133, HTTP `DELETE /channels/{id}`): soft removal of a Facebook/Instagram page (`status = 'removed'`, bot unbound, sealed token wiped, hidden from `list`); best-effort `MetaGateway.unsubscribe` (Graph `DELETE /{page-id}/subscribed_apps`, Facebook only, failures ignored and logged as code/subcode); website connections are refused. A later OAuth `select` of the same page in the same workspace restores that row; in another workspace (T-142) it creates a new row and the removed one stays as history. Only live rows are unique per `(provider, external_id)`, so any lookup by page id must exclude `removed` (this partially addresses T-049: the page is released for another business).
- HTTP: `/channels`, `/channels/{provider}/connect`, `/channels/discoveries/{id}[/select]`, `/channels/{id}`, `POST /channels/website`, `PATCH /channels/{id}/website`, `/channels/oauth/{provider}/callback`.

**Events consumed:** none. Raw webhook events are written by `apps/webhook` into `channel_webhook_events` and claimed by the agent process.

**Invariants:**

- OAuth state is bound to workspace, provider and user, and is single-use; discovery results are bound the same way.
- Page tokens are sealed with `SECRETS_ENCRYPTION_KEY` and never leave the module. Choosing pages clears the discovery's sealed tokens (`accounts_sealed = null`).
- A website connection's `token_sealed` is a random 32-byte visitor-signing secret (sealed with `SECRETS_ENCRYPTION_KEY`), never returned by any API; opened secrets are cached in a bounded in-process map. Tokens are bound to one site, so a token never verifies on another.
- Meta ingress and the Meta OAuth upsert filter by provider (`facebook`/`instagram`) and never touch `website` rows.
- Fanpage comments never open the Messenger window; private targets use comment ids and provenance is scoped to the page/workspace.
- Fanpage actions reserve under a comment lock before I/O; unknown/pending sends are never blindly retried.
- Every queue write after a claim is fenced by its claim token; a lease that expired may be renewed only while the token is unchanged.
- `removed` connections are invisible to `list`, never ingest (webhook ingress and `ConversationFacade.receive` refuse them) and never deliver; their rows, conversations and statistics stay.
- `reauth_required` connections keep ingesting and storing inbound events; only sending is blocked.
- A send never retries automatically: provider timeouts/5xx are `unknown`, explicit rejections are `failed`; `auth_expired` marks the connection `reauth_required`.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- channel`
