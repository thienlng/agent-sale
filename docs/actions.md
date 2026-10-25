# Bot API actions (T-055)

A shop owner declares HTTP APIs ("actions") the bot may call while answering a customer: look up an order, check ERP stock, create a booking. The model decides _when_ to call; the server decides _whether and how_. The model never touches the network, a URL, a header or a secret.

Design record: `docs/superpowers/specs/2026-10-25-bot-api-actions-design.md`. Module: `apps/backend/src/modules/action` (`MODULE.md`). UI: bot menu → **Hành động API** (`/app/bots/{botId}/actions`); the existing **Tích hợp** page stays channel connections.

## What an action declares

| Field | Notes |
|---|---|
| `name`, `description` | The model reads the description to decide when to call ("Tra trạng thái đơn theo mã đơn"). |
| `url`, `method` | HTTPS only. `{param}` placeholders must each match a `path` parameter. GET/POST/PUT/PATCH/DELETE. |
| `params[]` | `name`, `type` (string/number/boolean), `location` (path/query/header/body), `required`, `description`. |
| `responses[]` | `statusCode` + declared `fields`. Only these fields ever reach the model; an undeclared status is an error. |
| `auth` | none, API key header (header name + secret) or Bearer (secret). Secrets are sealed with `SecretBox`, write-only in the API (`hasSecret`), never sent to the model, never logged. |
| `requiresConfirm` | Default on for non-GET. The bot reads the parameters back and the customer must agree first. |
| `enabled` | Disabled actions are not offered to the model. |

## Turn flow

1. The playground builds an `<actions>` block (id, name, description, params, response fields — no URL, no auth) and, if one is stored, a `<pending_action>` block.
2. Model output outcomes: `answer | unknown | handoff | call_action | confirm_action | cancel_action` (`sales-agent@8`).
3. `call_action` for a read action → validate args against the declared params → `invoke` → the result goes back as `<action_result>{ok,statusCode,data}</action_result>` (`<` escaped, so injected text cannot close the tag; figures inside count as grounded) → model answers. At most 3 executions per customer turn, then the fallback (`action_loop_limit`).
4. `call_action` for a confirm-required action stores one pending call per conversation (10 min TTL) and sends the model's question to the customer. Nothing runs yet.
5. `confirm_action` executes the **stored** arguments, never model-supplied ones, then clears the pending call. `cancel_action` clears it. A confirm with nothing pending falls back.
6. Unknown, disabled or foreign action ids fall back like `unknown`.

Tokens of all rounds are summed into one `ai_runs` row (one billed AI message). `PlaygroundResponse.actions` lists `{name, ok, statusCode}` for the test-chat chips.

## Executor safety (`domain/safe-http.ts`, `ip-guard.ts`)

- DNS is resolved first; every address must be public (no loopback, RFC1918, CGNAT, link-local incl. 169.254.169.254, multicast, ULA, mapped/embedded IPv4). The socket connects to the validated IP, so DNS rebinding cannot swap it. Redirects are never followed. Userinfo in the URL is rejected.
- 8 s timeout, 256 KB response cap, JSON only.
- Args: types checked (string→number/boolean coerced only), unknown keys dropped, strings ≤ 500 chars, path values URL-encoded (`''`, `.`, `..` rejected), header params restricted and never `Host/Authorization/Cookie/Content-Length`.
- Write methods send `Idempotency-Key: bot:<eventId>:<actionId>` (`conv:<conversationId>:<actionId>:<hash>` without an event id), so requeued or retried events do not repeat a write.
- Responses are trimmed to the declared fields (strings ≤ 500 chars, arrays ≤ 10, depth ≤ 3).
- `action_runs` keeps status, latency and an error category only — no arguments, no bodies (PII).
- `ACTION_DEV_ALLOW_HTTP_HOSTS` lets QA reach a plain-http fake shop outside production; it is ignored in production.

## Testing an action

`POST /bots/{botId}/actions/{id}/test` with sample `args` runs the real executor (also for a disabled action) and returns `{ok, statusCode, data, errorCode, latencyMs}`; the form's **Thử gọi** panel uses it. Test runs are `is_test`.

## Known limits (v1)

No OAuth2/Basic auth, no per-action cross-conversation rate limit, no action templates, no native provider function calling (Hermes has no tools, ADR-010). Each action round adds one model call (3–8 s on the Hermes test provider).
