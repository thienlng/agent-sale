# Bot API actions (T-055)

A shop owner declares HTTP APIs ("actions") the bot may call while answering a customer: look up an order, check ERP stock, create a booking. The model decides _when_ to call; the server decides _whether and how_. The model never touches the network, a URL, a header or a secret.

Design record: `docs/superpowers/specs/2026-10-25-bot-api-actions-design.md`. Module: `apps/backend/src/modules/action` (`MODULE.md`). UI: bot menu → **Hành động API** (`/app/bots/{botId}/actions`); the existing **Tích hợp** page stays channel connections.

## What an action declares

| Field | Notes |
|---|---|
| `name`, `description` | The model reads the description to decide when to call ("Tra trạng thái đơn theo mã đơn"). |
| `url`, `method` | HTTPS only. `{param}` placeholders must each match a `path` parameter. GET/POST/PUT/PATCH/DELETE. |
| `params[]` | `name`, `type` (string/number/boolean), `location` (path/query/header/body), `required`, `description`. |
| `responses[]` | `statusCode` + declared `fields`. Only these fields ever reach the model; an undeclared status is an error. A field inside a list or object is declared by path: `items.code` keeps `code` of every element of `items` (first 10) and drops its siblings. |
| `auth` | none, API key header (header name + secret) or Bearer (secret). Secrets are sealed with `SecretBox`, write-only in the API (`hasSecret`), never sent to the model, never logged. |
| `requiresConfirm` | Default on for non-GET. The bot reads the parameters back and the customer must agree first. |
| `enabled` | Disabled actions are not offered to the model. |

## Turn flow

Actions are tools of the reply agent's tool loop (ADR-014, `sales-agent@11`/`@12`; code in `apps/backend/src/modules/ai/application/action-tools.ts`). The model's final JSON is only `answer | unknown | handoff`.

1. Each enabled action becomes a tool `action_<n>` (index by request; the name-to-action map stays on the server). Its description is the action's name and description; its input schema is built from the declared params. No URL, header or secret reaches the model. A stored pending call adds the tools `confirm_pending_action` and `cancel_pending_action` and a `<pending_action>` block in the last user message.
2. A call to a read action validates the arguments against the declared params, runs `invoke`, and returns `{ok,statusCode,data}` as the tool result (figures inside count as grounded). Failures return `{ok:false,errorCode}` only. At most 3 executions per customer turn, then the fallback (`action_loop_limit`); at most 4 tool rounds in total (`tool_loop_limit`).
3. A call to a confirm-required action does not run: the server stores one pending call per conversation (10 min TTL) and returns `{status:"awaiting_customer_confirmation",readBack:{...}}`; the model's reply reads the values back and asks the customer to agree.
4. `confirm_pending_action` takes the pending call atomically (`consumePending`: delete-returning, so of two concurrent confirmations only one runs the write), then executes the **stored** arguments, never model-supplied ones. If the call fails with a transient error (`timeout`, `network`) the pending call is put back so the customer can say "ok" again. The `<pending_action>` block carries `askedMinutesAgo`; the prompt tells the model to doubt an old pending call and re-ask. A confirmation question replaced by a guardrail fallback is dropped (the customer never saw it). `cancel_pending_action` clears it. A confirm with nothing pending falls back.
5. Unknown, disabled or foreign actions fall back like `unknown`.

Tokens of all rounds are summed into one `ai_runs` row (one billed AI message). `PlaygroundResponse.actions` lists `{name, ok, statusCode}` for the test-chat chips.

## Executor safety (`domain/safe-http.ts`, `ip-guard.ts`)

- The DNS lookup, and every connection attempt, share the one 8 s timeout. DNS is resolved first; every address must be public (no loopback, RFC1918, CGNAT, link-local incl. 169.254.169.254, multicast, ULA, mapped/embedded IPv4). The socket connects to a validated IP (IPv4 first; the next validated address is tried only after a connect-level failure, before any byte is sent), so DNS rebinding cannot swap it. Redirects are never followed. Userinfo in the URL is rejected.
- 256 KB response cap, JSON only.
- Args: types checked (string→number/boolean coerced only), unknown keys dropped, strings ≤ 500 chars, path values URL-encoded (`''`, `.`, `..` rejected), header params restricted and never `Host/Authorization/Cookie/Content-Length`. At save time the contract also rejects: header params named like reserved headers (`host`, `authorization`, `cookie`, `content-length`, `content-type`, `idempotency-key`, `accept`, `proxy-*`, `sec-*`) or like the API-key header, body params on GET, and param names that differ only by case. Only argument values that the customer wrote (or that a trusted result contains) vouch for figures in a confirmation question.
- Write methods send `Idempotency-Key: act:<conversationId>:<actionId>:<sha256(sorted args)[:32]>:<10-minute bucket>`. The channel event id is deliberately not part of it: a superseded or requeued event whose burst is answered later sends the same key, so the remote API can drop the duplicate. A write repeated with identical args inside the same 10-minute bucket is the same logical write.
- Responses are trimmed to the declared fields (strings ≤ 500 chars, arrays ≤ 10, depth ≤ 3).
- `action_runs` keeps status, latency and an error category only — no arguments, no bodies (PII).
- `ACTION_DEV_ALLOW_HTTP_HOSTS` lets QA reach a plain-http fake shop outside production; it is ignored in production.

## Testing an action

`POST /bots/{botId}/actions/{id}/test` with sample `args` runs the real executor on the **saved** action (also when disabled) and returns `{ok, statusCode, data, errorCode, latencyMs}`; test runs are `is_test`.

`POST /bots/{botId}/actions/test` with `{action, actionId?, args}` runs the form **as typed**, saved or not; the **Thử gọi** panel uses it, so the owner can iterate before saving. It stores nothing and records no run. A blank secret falls back to the stored secret of `actionId` (same bot only), so editing never forces retyping it.

## Known limits (v1)

No OAuth2/Basic auth, no per-action cross-conversation rate limit, no action templates, Hermes has no tools of its own (ADR-010), so it uses the emulated tool protocol of `packages/ai-core`. Each tool round adds one model call (3–8 s on the Hermes test provider).
