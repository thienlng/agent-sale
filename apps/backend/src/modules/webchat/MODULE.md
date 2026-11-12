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
- A visitor row is created on the first message, never on page view; its id is the conversation's `customer_id`. No IP or user agent is stored; addresses are hashed with a per-process secret and a daily salt and only feed rate limits (`RATE_LIMITER` port over the shared limiter in `common/limits`: Redis when `REDIS_URL` is set, so visitor, site and upload limits hold across instances; in-process counters when Redis is down). Address-keyed counters stay effectively per process while the hash secret is per process.
- The visitor token is signed per site (channel module); a `clientMessageId` is the event's `externalEventId`, so a retried send is deduplicated by the queue's unique index. Customer messages carry it back as `clientMessageId` so the widget de-duplicates its own messages.
- Attachments must be URLs produced by this site's upload route (`webchat/<workspace>/<connection>/…` under `S3_PUBLIC_URL`); uploads are checked by magic bytes, at most 5 MB. An upload is stored under `webchat-tmp/<workspace>/<connection>/` and copied to the permanent prefix when a message references it, and the temporary copy is then deleted (best effort); the worker deletes temporary uploads older than 24 h, so a send retried after that still resolves from the permanent object. Each site may upload `WEBCHAT_UPLOADS_SITE_DAY` files per day (429 past it); the cap is shared by all visitors of the site, so a bot can spend it (docs/08 §4b trade-off).
- Public responses use `{error: CODE}`, never the dashboard envelope, and echo the caller's `Origin` (never `*`). `OPTIONS` is answered by one `onRequest` hook for this prefix only.
- The queue event id is `<visitorId>:<clientMessageId>` (another visitor cannot suppress a message by reusing an id); the message's external id stays the plain `clientMessageId`.
- Site lookups are cached in process for 5 s (misses too, bounded); config and preflight are limited per address before any lookup. A site edit is visible after at most 5 s.
- Not persisted yet: the event `raw` (`page`, `seen`) is dropped at enqueue; only `webchat_visitors.first_url/last_url/last_title/referrer` survive.
- The visitor sees only what `ConversationFacade.listForVisitor` returns: customer messages and sent bot/staff messages, never notes.

- **Lead capture (T-102):** a phone comes from `POST /phone` or from a number found in message text (`findVnPhone`). It is validated with `normalizeLeadPhone` (placeholders such as `0987654321` are rejected: 422 on `/phone`, ignored in text). Capture = `crm.upsertLeadByPhone` (source `website`, name `Khách website <last 4>`) → `phone_e164`/`contact_id`/`phone_captured_at` on the visitor → `conversation.linkLead`. When the conversation does not exist yet (first message still queued) the link is made by the first poll that finds it. A changed number replaces the visitor's lead; the earlier customer is untouched. Failure to link never fails the visitor's request.
- **Required phone:** `phoneRequired = settings.requirePhoneAfter > 0 && no phone && message_count >= requirePhoneAfter` (`message_count` counts only newly queued messages, retries once). While required, text and images answer `409 PHONE_REQUIRED`; a message that itself contains a valid phone is accepted (it satisfies the requirement).
- **Email capture:** an address found in message text (`findEmail`: normalized, placeholder domains such as `example.com` ignored) is captured like a phone: `crm.upsertLeadByEmail` (name `Khách website <local part>`) → `email`/`email_captured_at`/`contact_id` on the visitor → `conversation.linkLead` with `{phone, email}`. The visitor's earlier customer is passed as `contactId`, so a phone and an email of one visitor end on one customer (a message carrying both captures the phone first). An email never satisfies `requirePhoneAfter`.
- **Page context:** every send carries `page.sections` (≤3 × `{name ≤80, text ≤400}`), the elements the site marked with `data-rapiz-section` that are on screen. It travels on the queued event (`NormalizedEvent.page`), is not stored on the visitor row, and reaches the bot as untrusted data (see the ai module, `website-page@2`). It also carries `page.nav` (≤24 `{label ≤80, url ≤1000}`, optional): the page's sections and header/nav/footer links, from which the bot may suggest same-origin places (ADR-029).
- **Rich messages:** polled agent messages carry the stored `ui` (product cards, suggested next steps) of a bot reply (ADR-029).
- Phones and emails are only ever logged masked (`maskPhone`, `maskEmail`).

- **A lead does not lift the AI caps (security audit #2):** a phone or email typed in any message, the first included, is captured as a lead (source `website`). Typed contact details are unverified, so a lead only moves the visitor from the anonymous reply budget to the larger all-visitor budget and the per-contact hourly cap (conversation module); it never exempts them.
- **Optional Turnstile:** off unless `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are both set. Then `GET /sites/{key}` returns `turnstileSiteKey`, and a new visitor's first message or upload must carry a `turnstileToken` the server verifies (403 `CHALLENGE_REQUIRED`).
- **AI replies to anonymous visitors are capped** per site and per workspace (hour and day); see the conversation module.

**Depends on (facades only):** `channel` (resolve/sign/verify/enqueue), `conversation` (`listForVisitor`, `linkLead`, `get`), `crm` (`upsertLeadByPhone`, `upsertLeadByEmail`), `bot` (language).

**Do not:** read other modules' tables; import knowledge internals (the S3 adapter is a copy of the pattern); log tokens, message text, IPs, phone numbers or emails.

**Test:** `pnpm --filter @agent-sales/backend test -- webchat` and `pnpm --filter @agent-sales/backend test:integration -- test/webchat.integration.spec.ts`
