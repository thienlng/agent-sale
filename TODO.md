# TODO — task board

Rules: `.agents/rules/03-task-tracking.md`. One line per task; details in `todo/`. Create tasks with `pnpm todo:new "Title"`. Order within a section = priority. Humans reorder; agents only move their own task between sections.

## In progress

Orders parity fixes from the testing agent's issues #16–#23 — branch `feat/T-023-orders-parity-fixes`: T-023, T-024, T-025, T-026, T-027 done; PR open for review.

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
- [ ] T-028 Structured product variants, dimensions and negative-stock policy — @unassigned · [details](todo/T-028-structured-product-variants-dimensions-and-negativ.md)

## Blocked

- [ ] T-002 Finalize open decisions (domain, data-center location, MVP channels) — @thienlng · blocked: human decision · [details](todo/T-002-finalize-open-decisions.md)

## Done (last 10 — older ones live in todo/done/)

- [x] T-027 Live-backend commerce E2E regression suite — @agent:claude · [details](todo/done/T-027-live-backend-commerce-e2e-regression-suite.md) · orders parity PR
- [x] T-026 Separate gross total from amount due on orders — @agent:claude · [details](todo/done/T-026-separate-gross-total-from-amount-due-on-orders.md) · orders parity PR
- [x] T-025 Order list multi-status include/exclude, creator and carrier filters — @agent:claude · [details](todo/done/T-025-order-list-multi-status-include-exclude-creator-an.md) · orders parity PR
- [x] T-024 Source-scoped order field policies for creation and confirmation — @agent:claude · [details](todo/done/T-024-source-scoped-order-field-policies-for-creation-an.md) · orders parity PR
- [x] T-023 Edit items and quantities on existing orders — @agent:claude · [details](todo/done/T-023-edit-items-and-quantities-on-existing-orders.md) · orders parity PR
- [x] T-022 Use setup-node v7 in the web CI job too — @agent:claude · [details](todo/done/T-022-use-setup-node-v7-in-the-web-ci-job-too.md)
- [x] T-019 Orders and products web: overview, order list, create order, detail, products, warehouses, settings — @agent:claude · [details](todo/done/T-019-orders-and-products-web-overview-order-list-create.md) · #13
- [x] T-018 Commerce backend: products, variants, warehouses, inventory, orders, statuses, overview — @agent:claude · [details](todo/done/T-018-commerce-backend-products-variants-warehouses-inve.md) · #13
- [x] T-017 Dashboard layout system: shadcn sidebar, user UI preferences, responsive guard — @agent:claude · [details](todo/done/T-017-dashboard-layout-system-shadcn-sidebar-user-ui-pre.md) · #13
- [x] T-005 Web dashboard: auth, bots, FAQ, settings, test chat, admin LLM settings — @agent:claude · [details](todo/done/T-005-scaffold-web.md) · #13
