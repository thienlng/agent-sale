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

## Links

- Related tasks: T-045, T-052
