---
id: T-053
title: Bot reply quality and pipeline robustness found by scenario QA
status: in-progress            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: @agent:claude-code     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-045
---

## Context

After PR #40 the Facebook inbox answers real customers through hermes-runtime. The owner asked for
deep end-to-end testing with a QA agent that seeds a realistic shop (products, FAQs, situation
instructions, images) and drives scenarios through signed webhooks, with fixes in the same loop.

## Goal

Every scenario in the suite passes with correct, grounded, Messenger-friendly replies, and defects
found are fixed with regression tests.

## Scope

- In scope: defects in the Meta inbox pipeline, AI prompt/grounding, handover and reply rules found by the scenario suite.
- Investigate only (no build): vision for customer images, bot-sent product images.

## Out of scope

- New features needing an owner decision (product image field, bot-sent images, vision contract).

## Acceptance criteria

- [ ] Scenario suite (15 scenarios) PASS or documented WARN
- [ ] Each fixed defect has a regression test
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

1. QA agent runs the suite and reports. 2. Fix by severity with tests. 3. Re-run the suite. 4. Write findings and open decisions here.

## Log

- 2026-10-24 — created; commits stay local on the T-052 branch until the owner asks to split and push.

- 2026-10-24 — vision / bot-sent images spike (read-only), findings:
  - Vision: Hermes can send `input_image` parts (`codex_responses_adapter.py`), but only if the model is known
    to support vision; otherwise it silently drops images. Whether the ChatGPT-plan Codex backend accepts images
    for gpt-6.x / gpt-5.6-* is NOT verified — a live smoke test with a synthetic image is the gate. Design: optional
    `images: [{mimeType, base64}]` on the bridge request (caps 3 images / 3 MB, fail closed with VISION_UNSUPPORTED),
    NestJS fetches Meta CDN images (fbcdn/cdninstagram allowlist, size cap, no redirects, never logged or stored),
    workspace toggle default off. Effort M-L. Owner decisions: customer photos go to OpenAI (privacy/disclosure),
    ChatGPT-plan terms for a hosted bot, cost/latency.
  - Bot-sent images: product image field (preferably a reference to a `media` library item), model returns
    `imageIds` from a server-built allowlist (max 3, never URLs), one outbound message per image after the text with
    idempotency keys `bot:<eventId>:img<n>`, image failure never fails or hands off the text reply. Effort M.
  - Recommended order: bot-sent images first (no new data to OpenAI), then vision after the smoke test and the owner's decision.
- 2026-10-24 — QA round 2 fixes (uncommitted on the T-052 branch):
  - Burst answered only the newest question: the processor sent each customer message as its own turn and the model answered the last one. `application/jobs/reply-turns.ts` now merges all consecutive customer messages after the last bot/staff message into ONE turn (newline-joined, attachment notes once); `sales-agent@4` says to answer every question of the latest messages in order. A burst ending with an image answers the text (one reply, no extra handoff). A message claimed in a later tick still gets its own reply with the earlier reply in context. Tests: parallel / straddling / ending-with-image bursts in `meta-inbox.processor.spec.ts`.
  - Repeated greeting: the AI request already includes earlier sent bot and staff turns, so history construction is fine. In the QA stack the synthetic page token makes every send fail (`auth_expired`), and failed outbound messages are correctly left out of the history, so the next reply looked like a first one. Prompt strengthened anyway (never open with a greeting or "chào" when any assistant message exists). Live: first message greets; follow-ups, burst follow-ups and after staff message + resume do not (3 runs each via playground, plus one end-to-end run with the sends flipped to `sent`).
  - English message: the courtesy sentence no longer promises follow-up (the conversation stays in bot mode, nobody is alerted); it invites the customer to write in Vietnamese or share a phone number. `docs/06-ai-engine.md` updated.
- 2026-10-24 — QA round 3 fixes (uncommitted on the T-052 branch):
  - Failed/pending/unknown sends made the bot repeat earlier answers: the processor dropped failed outbound messages before computing the customer turn, so every earlier message looked unanswered. Outbound messages of ANY status now bound the merge (`reply-turns.ts`, `meta-inbox.processor.ts`); only sent text is shown as an assistant turn, so consecutive customer turns can reach the model and the prompt answers only the last `<customer>` block. A retry of an event whose reply was already attempted (last stored message outbound) is skipped: no second answer, no second send (failed sends are never retried automatically, staff see them). Tests: failed/pending/unknown/sent in history and the retry case.
  - Intermittent fallback (`invalid_output`): see result below. `parseModelReply` (`ai/domain/model-reply.ts`) tolerates a code fence or prose around the JSON, the schema stays strict; invalid output is retried once; the guardrail now records the category (`invalid_output:empty|not_json|schema`), never text. `decide` moved to `application/decide-reply.ts`.
  - No staff signal for a promised callback: prompt makes a customer phone number outcome `handoff` with a one-sentence confirmation (conversation goes to human mode); the lead-in guard already allows figures the customer wrote and now compares phone numbers ignoring spaces, dots and dashes. Default fallback text (packs + built-in) no longer promises a follow-up: it asks for detail or a phone number. Existing bots keep their stored text (owner can edit it in settings). The phrase "Em thông tin để anh/chị tiện cân nhắc" is not in the prompt or examples (model output); the prompt now asks for complete sentences.
- 2026-10-24 — QA round 4 prompt WARNs (`sales-agent@4`, uncommitted):
  - Merged multi-question turn: the prompt now says to answer each question the blocks can answer, the "unknown" fallback is only for when none can be answered, and a missing part is acknowledged briefly. Replies state only facts present in the blocks (no inferred eligibility/promotions). Filler openers ("em xin trả lời:") are discouraged without quoting them (quoting the phrase made the model copy it). Unit assertions in `playground.spec.ts`.
  - Live (playground, synthetic bot): 6 merged-turn runs (both orders) and 3 order questions all answered every question, no fallback; ship x3, warranty x3, price-after-size, injection refusal (fallback), apology handoff, wholesale phone request and callback-number handoff behaved as expected. Residual: warranty replies sometimes add a verb like "em xác nhận/em tư vấn" (cosmetic); "hết hàng" appears because the seeded variants have no stock.
- 2026-10-24 — vision built (owner decision: ChatGPT plan is testing only; images may go to OpenAI in dev; gated by `BOT_IMAGE_VISION`, default on outside production):
  - Gate: live smoke test through Hermes `AIAgent` with a synthetic PNG ("RAPIZ 123" + red rectangle): gpt-6.1-sol, gpt-5.6-luna, gpt-6-luna all read it; `_model_supports_vision` is already true, no config change needed.
  - Bridge: optional `images` (caps, magic bytes, strict base64, `VISION_UNSUPPORTED` 503), larger body only for image requests. ai-core: `GenerateRequest.images`, Hermes serializes, other providers throw. Prompt `sales-agent@5` (image rule). Playground request accepts `images` (max 3). `SafeImageFetcher` (Meta CDN allowlist, DNS-pinned public IP, no redirects, 5 s, 3 MB, magic bytes; `BOT_IMAGE_EXTRA_HOSTS` dev/test). Processor fetches the newest 3 images, image-only turns go to the model, text-only retry if the image call fails.
  - Tests: Python 37, ai-core, backend processor/fetcher/playground specs.
- 2026-10-24 — bot-sent images built (owner decision: images sent to customers come only from our stored https URLs; the ChatGPT plan stays test-only), uncommitted on the T-052 branch:
  - Data: migration `0014_product_images.sql` (additive: `products.image_urls jsonb not null default '[]'`, CHECK array of at most 5; applied on `rapiz_acceptance` and on a fresh test DB). Contracts: `ProductDto`/`UpsertProductRequest.imageUrls` (max 5, https, 2000 chars), `PlaygroundResponse.images`. Commerce persists and returns it through `getBotProducts`. Web: "Ảnh sản phẩm" section in the product form (`product-images-editor.tsx`, thumbnails, add/remove, Enter adds, vi+en). No image count in the bot products table (not trivial).
  - AI: `domain/image-allowlist.ts` (max 10 entries; `p:<productId>:<index>` from retrieved products, `m:<itemId>` from matching `media` library items), `sales-agent@6` (= @5 + the one rule + an `imageIds` line in the output list), `ModelReply.imageIds` (default `[]`, so strict JSON schema providers still list it as required), server validation (foreign/invented/URL-looking ids dropped, dedupe, cap 3, answered outcomes only), compact `Images you may send (id: label)` block with no URLs.
  - Delivery: `ConversationFacade.commitBotImage` reuses `reserveAndDeliver` (control `'follow-up'`: bot must still hold the conversation, no revision check because the text already bumped it; same 24-hour window and idempotency). The processor sends pictures sequentially after the committed text, keys `bot:<eventId>:img<n>`; failures/unknown are recorded as outbound messages and never fail, retry or hand over the event; takeover or a closed window stops the rest. Replay is skipped before the AI call; a repeated key returns the stored message.
  - Found live and fixed: `getBotProducts` capped its search terms at 5 and counted "xem/ảnh/phí/vậy" as terms, so a product named in the second half of a merged turn ("phí ship bao nhiêu vậy / cho xem ảnh giày sneaker trắng") was never retrieved and the bot answered with the fallback. Now picture-request filler is ignored and up to 8 terms are searched (`commerce/domain/bot-product-search.ts`, unit test). Before: 4/4 fallback or "no photo"; after: 3/3 answer + 2 pictures.
  - Live (synthetic bot, fake page token so every Graph send is recorded as failed `auth_expired`; a temporary trigger kept the connection `connected` and was dropped): "cho xem ảnh giày da Oxford" -> text + `:img1..img3` image messages in order; price question -> text only; image-library item ("bảng size giày") -> text + `:img1`; photo of an item not in the catalog -> fallback text only; product without pictures -> fallback text only (gap below); burst ending with an image request -> one reply + 2 pictures; replay of the same webhook -> no duplicate messages. Everything cleaned up (bot, products, connection, conversations, events, orphan outbox rows).
  - Tests: ai-core 34, backend modules 428+ (allowlist 9, image replies 7, processor 8, facade 2, product search 3), contracts 15, web editor 4, commerce integration 14 (images on Postgres).
  - Open for the owner: (1) a product without pictures answers "show me the photo" with the generic fallback instead of "no photo yet" (model treats it as unknown; fixing needs a prompt rule or a catalog hint, so it was left); (2) Meta must be able to fetch the https URL from the shop's host (hot-link protection or short-lived URLs fail at Meta and show as a failed message); (3) no upload or library reference for product pictures yet (links only); (4) after a text send fails with `auth_expired` the connection is `reauth_required` and the pictures are skipped (logged), which is intended.

- 2026-10-24 — acceptance plan for images (run by QA after the bot-sent-images work lands; sequential Hermes; synthetic data only):
  Receive: (1) shoe photo + "đôi giày này giá bao nhiêu?" → names the matching product and the catalog price; (2) image-only that is unrelated to the shop → polite clarifying/fallback, no invented data; (3) 3 images in one message → at most 3 used; (4) unreachable URL, non-allowlisted host, oversize, wrong content-type → text-only degrade, no crash; (5) vision flag off → old note/handoff behaviour; (6) image + burst of text → one merged answer.
  Send: (7) "cho xem ảnh giày Oxford" → text + the product's images in order, keys `bot:<eventId>:img<n>`; (8) price question without a picture request → no images; (9) product without images → text only; (10) item not in the catalog → no images; (11) replay of the same webhook → no duplicate image messages; (12) 24h window closed → text only; (13) image delivery failure (fake token) → text kept, mode stays `bot`, failed image message visible in the inbox; (14) model returns an invented id → dropped.
  Not verifiable without real Meta: actual rendering of sent images in Messenger/Instagram and Meta's real CDN URLs/hosts (allowlist is from docs, not re-verified live).

## Links

- Related tasks: T-045, T-052
