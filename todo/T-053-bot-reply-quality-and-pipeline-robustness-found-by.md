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

## Links

- Related tasks: T-045, T-052
