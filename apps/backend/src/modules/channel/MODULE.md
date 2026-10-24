# channel

**Purpose:** Connects Facebook Pages and Instagram professional accounts to a workspace (Meta OAuth, sealed page tokens, bot binding) and delivers outbound messages through the Meta adapter.

**Owned tables:** `channel_connections`, `channel_oauth_flows`, `channel_webhook_events` (schema in `packages/db/src/schema/channel.ts`, migrations 0005/0007).

**Public API (`api/`):**
- `CHANNEL_FACADE` → `getConnection`, `deliver(ws, id, recipient, { text | attachment }, key)`, `claimEvents`, `renewEvent`, `releaseEvent`, `completeEvent`
- `MAX_EVENT_ATTEMPTS` (3): the store stops claiming an event after this many attempts.
- HTTP: `/channels`, `/channels/{provider}/connect`, `/channels/discoveries/{id}[/select]`, `/channels/{id}`, `/channels/oauth/{provider}/callback`.

**Events consumed:** none. Raw webhook events are written by `apps/webhook` into `channel_webhook_events` and claimed by the agent process.

**Invariants:**
- OAuth state is bound to workspace, provider and user, and is single-use; discovery results are bound the same way.
- Page tokens are sealed with `SECRETS_ENCRYPTION_KEY` and never leave the module.
- A send never retries automatically: provider timeouts/5xx are `unknown`, explicit rejections are `failed`; `auth_expired` marks the connection `reauth_required`.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- channel`
