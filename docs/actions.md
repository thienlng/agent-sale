# Bot API actions (T-055)

A shop owner declares HTTP APIs ("actions") the bot may call while answering a customer: look up an order, check ERP stock, create a booking. The model decides _when_ to call; the server decides _whether and how_. The model never touches the network, a URL, a header or a secret.

Design record: `docs/superpowers/specs/2026-10-25-bot-api-actions-design.md`. Module: `apps/backend/src/modules/action` (`MODULE.md`). UI: bot menu → **Hành động API** (`/app/bots/{botId}/actions`); the existing **Tích hợp** page stays channel connections. Every `/bots/{botId}/actions` route needs `bots.manage` (owner and admin); other roles get 403, and the web app hides the menu entry and shows a no-permission note on the pages.

## What an action declares

| Field | Notes |
|---|---|
| `name`, `description` | The model reads the description to decide when to call ("Tra trạng thái đơn theo mã đơn"). |
| `url`, `method` | HTTPS only. `{param}` placeholders must each match a `path` parameter and may not sit in the host, port or userinfo (call arguments never choose where the secret goes). GET/POST/PUT/PATCH/DELETE. |
| `params[]` | `name`, `type` (string/number/boolean), `location` (path/query/header/body), `required`, `description`, optional `source` (who fills the value, see [Params filled by the server](#params-filled-by-the-server)). |
| `responses[]` | `statusCode` + declared `fields`. Only these fields ever reach the model; an undeclared status is an error. A field inside a list or object is declared by path: `items.code` keeps `code` of every element of `items` (first 10) and drops its siblings. |
| `auth` | none, API key header (header name + secret) or Bearer (secret). Secrets are sealed with `SecretBox`, write-only in the API (`hasSecret`), never sent to the model, never logged. Changing the URL origin or how the key is sent needs the secret again: without a new one (or an explicit clear) the update is refused with 400 `details.reason: secret_required`, and the form asks for it before saving. |
| `requiresConfirm` | Default on for non-GET. The bot reads the parameters back and the customer must agree first. |
| `enabled` | Disabled actions are not offered to the model. |

## Params filled by the server

A param's optional `source` says who fills its value:

| `source` | Value | Notes |
|---|---|---|
| `model` (default, also when absent) | What the model passes in the tool call | Every action saved before `source` existed behaves exactly as before. |
| `customer_phone` | The phone stored on the conversation's CRM contact | `type` must be `string` (the contract refuses anything else). |
| `customer_email` | The email stored on the conversation's CRM contact | `type` must be `string`. |

A param with a non-model source is not in the tool's input schema, so the model cannot set it; a value the model passes anyway is ignored, and the server fills it from the CRM record (`CRM_FACADE.getContact` on the conversation's contact, never what anyone typed in this turn). Use it for anything that identifies the customer to the shop's API ("look up **my** orders", "call me back"): a model-filled phone lets any customer ask about another person's orders. The binding only stops the model from choosing a value mid-turn; it is **not** proof of ownership. The contact's phone and email may themselves have been typed by the customer earlier (for example given in chat and saved to the contact), so a shop API that returns sensitive data should still verify the customer on its side (an OTP, an order code).

When a required server-filled value is unknown (no contact, or the contact has no phone or email yet), the action is not offered that turn, and a call that reaches the server anyway returns `invalid_arguments` and runs nothing. An optional one is left out of the call. In the dashboard test chat (the playground) the owner is the customer and there is no contact, so the model fills every param there, `source` included, to let the owner try the flow. The UI is the **Nguồn giá trị** / **Filled by** select on each param row of the action form.

## Public comment replies

A reply to a public fanpage comment is written for a stranger, in public: it gets **no action tools at all** (nor `send_message`, the pending call or the order tools). The bot can still answer from the knowledge and hand over. A comment reply that would show a phone number or an email is not posted and goes to review instead (`exposesContactDetails` in `packages/shared`, checked by the fanpage comment processor).

## Turn flow

Actions are tools of the reply agent's loop (ADR-014, ADR-015; prompts `sales-agent@13`/`@14`; code in `apps/backend/src/modules/ai/application/action-tools.ts`). The model's final answer is free text; the outcome is derived: `handoff` when the handoff tool ran, `answered` when a message reached the customer, otherwise `fallback` (the bot's fallback message).

1. Each enabled action becomes a tool `action_<n>` (index by request; the name-to-action map stays on the server). Its description is the action's name and description; its input schema is built from the declared params the model fills (`source` absent or `model`). No URL, header or secret reaches the model. A stored pending call adds the tools `confirm_pending_action` and `cancel_pending_action` and a `<pending_action>` block in the last user message.
2. A call to a read action validates the arguments against the declared params, runs `invoke`, and returns `{ok,statusCode,data}` as the tool result (figures inside count as grounded). Failures return `{ok:false,errorCode}` only. At most 3 executions per customer turn, then the fallback (`action_loop_limit`); at most 10 agent-loop rounds in total (`tool_loop_limit`, ADR-015).
3. A call to a confirm-required action does not run: the server stores one pending call per conversation (10 min TTL) and returns `{status:"awaiting_customer_confirmation",readBack:{...}}`; the model's reply reads the values back and asks the customer to agree.
4. `confirm_pending_action` takes the pending call atomically (`consumePending`: delete-returning, so of two concurrent confirmations only one runs the write), then executes the **stored** arguments, never model-supplied ones. If the call fails with a transient error (`timeout`, `network`) the pending call is put back so the customer can say "ok" again. The `<pending_action>` block carries `askedMinutesAgo`; the prompt tells the model to doubt an old pending call and re-ask. A confirmation question replaced by a guardrail fallback is dropped (the customer never saw it). `cancel_pending_action` clears it. A confirm with nothing pending falls back.
5. Unknown, disabled or foreign actions fall back like `unknown`.

Every `send_message` text and the final reply pass the pre-send guard (docs/06 §3.3): a reply that copies a long run of the action descriptions is refused like any other instruction leak, and with `BOT_REPLY_FIGURE_GUARD=true` a figure has to come from the action's returned data (or another trusted text), never from the arguments the model chose.

Tokens of all rounds are summed into one `ai_runs` row (one billed AI message). `PlaygroundResponse.actions` lists `{name, ok, statusCode}` for the test-chat chips.

## Executor safety (`common/security/safe-http.ts`, `ip-guard.ts`)

- The DNS lookup, and every connection attempt, share the one 8 s timeout. DNS is resolved first; every address must be public (no loopback, RFC1918, CGNAT, link-local incl. 169.254.169.254, multicast, ULA, mapped/embedded IPv4). The socket connects to a validated IP (IPv4 first; the next validated address is tried only after a connect-level failure, before any byte is sent), so DNS rebinding cannot swap it. Redirects are never followed. Userinfo in the URL is rejected.
- 256 KB response cap, JSON only.
- Args: types checked (string→number/boolean coerced only), unknown keys dropped, strings ≤ 500 chars, path values URL-encoded (`''`, `.`, `..` rejected), header params restricted and never `Host/Authorization/Cookie/Content-Length`. At save time the contract also rejects: header params named like reserved headers (`host`, `authorization`, `cookie`, `content-length`, `content-type`, `idempotency-key`, `accept`, `proxy-*`, `sec-*`) or like the API-key header, body params on GET, and param names that differ only by case. Only argument values that the customer wrote (or that a trusted result contains) vouch for figures in a confirmation question.
- Write methods send `Idempotency-Key: act:<conversationId>:<actionId>:<sha256(sorted args)[:32]>:<10-minute bucket>`. The channel event id is deliberately not part of it: a superseded or requeued event whose burst is answered later sends the same key, so the remote API can drop the duplicate. A write repeated with identical args inside the same 10-minute bucket is the same logical write.
- Responses are trimmed to the declared fields (strings ≤ 500 chars, arrays ≤ 10, depth ≤ 3).
- `action_runs` keeps status, latency and an error category only — no arguments, no bodies (PII).
- `ACTION_DEV_ALLOW_HTTP_HOSTS` lets QA reach a plain-http fake shop outside production; it is ignored in production.

## Testing an action

`POST /bots/{botId}/actions/{id}/test` with sample `args` runs the real executor on the **saved** action (also when disabled) and returns `{ok, statusCode, data, errorCode, latencyMs}`; test runs are `is_test`.

`POST /bots/{botId}/actions/test` with `{action, actionId?, args}` runs the form **as typed**, saved or not; the **Thử gọi** panel uses it, so the owner can iterate before saving. It stores nothing and records no run. A blank secret falls back to the stored secret of `actionId` (same bot only) when the draft keeps the stored URL origin (scheme, host, port) and auth kind and header name, so editing the path or the params never forces retyping it. A draft aimed at another origin or sending the key differently runs without the stored secret: it is only ever sent where it was entered for.

## Drafted by the owner assistant (T-174)

The owner can paste an endpoint's docs or a curl example into the owner assistant ("Rapiz Agent"). Keys in the pasted text are masked before the message is stored or reaches the model (`[secret removed]`; the bubble says so). The `set-up-api-action` skill maps the text to an action and proposes `POST /bots/{botId}/actions`; for the assistant that route accepts only `ActionAssistantDraft` (`ActionInput` without `authSecret`, `enabled: false`, strict at every depth), so a draft carrying a secret (even nested, like `auth.token`) or switched on is refused before any proposal exists; a URL query key or header param named like a secret (`key`, `token`, `secret`, `password`, `signature`, `auth`) is refused with `secret_in_draft`. The proposal stores the parsed body, never the raw one, and approval re-checks it. Approving creates the action **disabled and without its secret**; the card's **Mở để nhập khoá** button opens it, the list shows **Cần nhập khoá** while `auth.kind ≠ none` and no secret is stored, and the assistant spotlights the secret field, **Thử gọi** and the on switch (`data-assistant-target` `actions.secret`, `actions.test`, `actions.enabled`). The owner types the key, tests and turns the action on; the assistant never fetches docs links, never tests an action and cannot edit, delete or test one (`PATCH`, `DELETE` and both test routes stay `assistant: never`).

## Built-in actions

Some industries get an action without declaring it: a bot of a request industry (`saas`, `education`, `spa`) has the built-in tool `record_request` (ADR-025, generalising ADR-020). It records a demo, trial, consultation, placement-test or appointment request on the customer through the `crm` facade in-process (no HTTP, no run log, no confirmation). Its contact details are vouched by their own rule: the phone's last 9 digits or the whole email address must appear in what the customer wrote. See [SaaS businesses](saas.md#bot-behavior) and [Education and spa businesses](education-and-spa.md).

## Known limits (v1)

No OAuth2/Basic auth, no per-action cross-conversation rate limit, no action templates, Hermes has no tools of its own (ADR-010), so it uses the emulated tool protocol of `packages/ai-core`. Each tool round adds one model call (3–8 s on the Hermes test provider).
