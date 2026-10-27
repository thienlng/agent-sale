# webchat

**Purpose:** website chat channel: the public widget API (no login), visitors, origin check, rate limits, image uploads, and the visitor details staff see in the inbox. Messages reuse the Facebook inbox pipeline.

**Owned tables:** `webchat_visitors` (migrations 0026, 0027 `message_count`; schema in `packages/db/src/schema/webchat.ts`, tenant RLS).

**Public API (`api/`):**

- `WEBCHAT_FACADE` → `WebchatFacade.getVisitor(ws, conversationId)` (visitor details of a website conversation)
- HTTP, public (`@Public()`, not workspace scoped, prefix `/api/v1`): `GET /webchat/v1/sites/{key}`, `POST|GET /webchat/v1/sites/{key}/messages`, `POST /webchat/v1/sites/{key}/uploads` (multipart `file`), `POST /webchat/v1/sites/{key}/phone` (`{phone}` → 200 `{phoneCaptured:true}`, 422 `INVALID_PHONE`, 429)
- HTTP, authed: `GET /webchat/conversations/{conversationId}/visitor`
- Events: none yet.

**Events consumed:** none.

**Invariants:**

- Every public call resolves the site (`channel.resolveWebsite`) and answers a uniform `404 {error:"NOT_FOUND"}` for an unknown key, a site that is not `connected` or an `Origin` outside `settings.domains`.
- A visitor row is created on the first message, never on page view; its id is the conversation's `customer_id`. No IP or user agent is stored; addresses are hashed with a per-process secret and a daily salt and only feed in-memory rate limits (`RATE_LIMITER` port, `InMemoryRateLimiter`).
- The visitor token is signed per site (channel module); a `clientMessageId` is the event's `externalEventId`, so a retried send is deduplicated by the queue's unique index. Customer messages carry it back as `clientMessageId` so the widget de-duplicates its own messages.
- Attachments must be URLs produced by this site's upload route (`webchat/<workspace>/<connection>/…` under `S3_PUBLIC_URL`); uploads are checked by magic bytes, at most 5 MB.
- Public responses use `{error: CODE}`, never the dashboard envelope, and echo the caller's `Origin` (never `*`). `OPTIONS` is answered by one `onRequest` hook for this prefix only.
- The queue event id is `<visitorId>:<clientMessageId>` (another visitor cannot suppress a message by reusing an id); the message's external id stays the plain `clientMessageId`.
- Site lookups are cached in process for 5 s (misses too, bounded); config and preflight are limited per address before any lookup. A site edit is visible after at most 5 s.
- Not persisted yet: the event `raw` (`page`, `seen`) is dropped at enqueue; only `webchat_visitors.first_url/last_url/last_title/referrer` survive.
- The visitor sees only what `ConversationFacade.listForVisitor` returns: customer messages and sent bot/staff messages, never notes.

- **Lead capture (T-102):** a phone comes from `POST /phone` or from a number found in message text (`findVnPhone`). It is validated with `normalizeLeadPhone` (placeholders such as `0987654321` are rejected: 422 on `/phone`, ignored in text). Capture = `crm.upsertLeadByPhone` (source `website`, name `Khách website <last 4>`) → `phone_e164`/`contact_id`/`phone_captured_at` on the visitor → `conversation.linkLead`. When the conversation does not exist yet (first message still queued) the link is made by the first poll that finds it. A changed number replaces the visitor's lead; the earlier customer is untouched. Failure to link never fails the visitor's request.
- **Required phone:** `phoneRequired = settings.requirePhoneAfter > 0 && no phone && message_count >= requirePhoneAfter` (`message_count` counts only newly queued messages, retries once). While required, text and images answer `409 PHONE_REQUIRED`; a message that itself contains a valid phone is accepted (it satisfies the requirement).
- Phones are only ever logged masked (`maskPhone`).

**Depends on (facades only):** `channel` (resolve/sign/verify/enqueue), `conversation` (`listForVisitor`, `linkLead`, `get`), `crm` (`upsertLeadByPhone`), `bot` (language).

**Do not:** read other modules' tables; import knowledge internals (the S3 adapter is a copy of the pattern); log tokens, message text, IPs or phone numbers.

**Test:** `pnpm --filter @agent-sales/backend test -- webchat` and `pnpm --filter @agent-sales/backend test:integration -- test/webchat.integration.spec.ts`
