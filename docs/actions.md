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
5. `confirm_action` takes the pending call atomically (`consumePending`: delete-returning, so of two concurrent confirmations only one runs the write), then executes the **stored** arguments, never model-supplied ones. If the call fails with a transient error (`timeout`, `network`) the pending call is put back so the customer can say "ok" again. The `<pending_action>` block carries `askedMinutesAgo`; the prompt tells the model to doubt an old pending call and re-ask. A confirmation question replaced by a guardrail fallback is dropped (the customer never saw it). `cancel_action` clears it. A confirm with nothing pending falls back.
6. Unknown, disabled or foreign action ids fall back like `unknown`.

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

`POST /bots/{botId}/actions/{id}/test` with sample `args` runs the real executor (also for a disabled action) and returns `{ok, statusCode, data, errorCode, latencyMs}`; the form's **Thử gọi** panel uses it. Test runs are `is_test`.

## Known limits (v1)

No OAuth2/Basic auth, no per-action cross-conversation rate limit, no action templates, no native provider function calling (Hermes has no tools, ADR-010). Each action round adds one model call (3–8 s on the Hermes test provider).
