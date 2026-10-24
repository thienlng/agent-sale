# TODO — task board

Rules: `.agents/rules/03-task-tracking.md`. One line per task; details in `todo/`. Create tasks with `pnpm todo:new "Title"`. Order within a section = priority. Humans reorder; agents only move their own task between sections.

## In progress

- [ ] T-023 Implement Preny bot training and Meta inbox with an isolated Hermes runtime — @agent:codex · [details](todo/T-023-implement-preny-bot-training-and-meta-inbox-with-a.md)

Milestone **M2-bot-playground** — branch `feat/T-015-m2-bot-playground`: T-015, T-016, T-005, T-017, T-018, T-019 done; PR #13 open for review.

## Next

(none)

## Backlog

- [ ] T-013 Choose self-hosted object storage now that MinIO stopped publishing community images — @unassigned · [details](todo/T-013-choose-self-hosted-object-storage-now-that-minio-s.md)
- [ ] T-006 Add Testcontainers integration test harness and cross-tenant test helper — @unassigned · [details](todo/T-006-integration-test-harness.md)
- [ ] T-007 Add packages/ai-core LLM gateway skeleton with eval runner — @unassigned · [details](todo/T-007-ai-core-skeleton.md)
- [ ] T-008 Add deploy workflows (dev/staging) and environment docs — @unassigned · [details](todo/T-008-deploy-workflows.md)
- [ ] T-011 Add Claude Code hooks: eslint --fix after edits and pnpm check on stop — @unassigned · [details](todo/T-011-add-claude-code-hooks-eslint-fix-after-edits-and-p.md)
- [ ] T-020 Orders follow-ups: Excel import, product images, 2-level address picker, carriers and printing, multi-tab drafts — @unassigned · [details](todo/T-020-orders-follow-ups-excel-import-product-images-2-le.md)
- [ ] T-021 Fix the root pnpm gen script (turbo gen needs --args) — @unassigned · [details](todo/T-021-fix-the-root-pnpm-gen-script-turbo-gen-needs-args.md)
- [ ] T-024 Fix flaky tampered access-token test in identity auth flow — @unassigned · [details](todo/T-024-fix-flaky-tampered-access-token-test-in-identity-a.md)

## Blocked

- [ ] T-002 Finalize open decisions (domain, data-center location, MVP channels) — @thienlng · blocked: human decision · [details](todo/T-002-finalize-open-decisions.md)

## Done (last 10 — older ones live in todo/done/)

- [x] T-019 Orders and products web: overview, order list, create order, detail, products, warehouses, settings — @agent:claude · [details](todo/done/T-019-orders-and-products-web-overview-order-list-create.md) · M2 PR
- [x] T-018 Commerce backend: products, variants, warehouses, inventory, orders, statuses, overview — @agent:claude · [details](todo/done/T-018-commerce-backend-products-variants-warehouses-inve.md) · M2 PR
- [x] T-017 Dashboard layout system: shadcn sidebar, user UI preferences, responsive guard — @agent:claude · [details](todo/done/T-017-dashboard-layout-system-shadcn-sidebar-user-ui-pre.md) · M2 PR
- [x] T-005 Web dashboard: auth, bots, FAQ, settings, test chat, admin LLM settings — @agent:claude · [details](todo/done/T-005-scaffold-web.md) · M2 PR
- [x] T-016 AI playground, LLM providers (Anthropic + OpenAI-compatible) and admin-managed tier routing — @agent:claude · [details](todo/done/T-016-ai-playground-llm-providers-faq-retrieval-grounded.md) · M2 PR
- [x] T-015 Bot and knowledge modules — @agent:claude · [details](todo/done/T-015-bot-and-knowledge-modules-bots-settings-faq-indust.md) · M2 PR
- [x] T-014 Authentication and workspace onboarding — @agent:claude · [details](todo/done/T-014-authentication-and-workspace-onboarding-signup-log.md) · M1-foundation PR
- [x] T-003 Complete the backend runtime: OpenAPI, request tracing, readiness, metrics — @agent:claude · [details](todo/done/T-003-scaffold-api.md) · M1-foundation PR
- [x] T-004 Wire the database: local infra, migration runner, RLS integration tests, Drizzle repositories — @agent:claude · [details](todo/done/T-004-packages-db.md) · M1-foundation PR
- [x] T-012 Record brand Razpi, white-orange theme and single maintainer — @agent:claude · [details](todo/done/T-012-record-brand-razpi-white-orange-theme-and-single-m.md)
- [x] T-010 Scaffold codebase skeleton and architecture conventions — @agent:claude · [details](todo/done/T-010-scaffold-codebase-skeleton-and-architecture-conven.md) · PR #10 (squashed into #9)
- [x] T-009 Decide performance-oriented tech stack (ADR-009) — @agent:claude · [details](todo/done/T-009-decide-performance-oriented-tech-stack-adr-009.md) · PR #9
- [x] T-001 Repository foundation: agent rules, skills, tooling, CI — initial commit
