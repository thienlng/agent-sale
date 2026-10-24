# TODO — task board

Rules: `.agents/rules/03-task-tracking.md`. One line per task; details in `todo/`. Create tasks with `pnpm todo:new "Title"`. Order within a section = priority. Humans reorder; agents only move their own task between sections.

## In progress

Milestone **M3b-team-access** — branch `feat/T-043-m3b-team-access`: T-043, T-044, T-033 done; PR #41 open for review.

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
- [ ] T-034 CRM tasks, reminders and recurring follow-ups — @unassigned · [details](todo/T-034-crm-tasks-reminders-and-recurring-follow-ups.md)
- [ ] T-035 CRM versioned custom contact fields — @unassigned · [details](todo/T-035-crm-versioned-custom-contact-fields.md)
- [ ] T-036 CRM customer import preview, deduplication and merges — @unassigned · [details](todo/T-036-crm-customer-import-preview-deduplication-and-merg.md)
- [ ] T-037 CRM customer files, scoped exports and archive/restore — @unassigned · [details](todo/T-037-crm-customer-files-scoped-exports-and-archive-rest.md)
- [ ] T-038 CRM conversation-driven rules and historical sync — @unassigned · [details](todo/T-038-crm-conversation-driven-rules-and-historical-sync.md)
- [ ] T-039 Analytics metric definitions and attribution — @unassigned · [details](todo/T-039-analytics-metric-definitions-and-attribution.md)
- [ ] T-040 Analytics events, temporal state and rebuildable projections — @unassigned · [details](todo/T-040-analytics-events-temporal-state-and-rebuildable-pr.md)
- [ ] T-041 Statistics dashboard, breakdowns and drilldowns — @unassigned · [details](todo/T-041-statistics-dashboard-breakdowns-and-drilldowns.md)
- [ ] T-042 CRM and statistics permissions, entitlements and acceptance suite — @unassigned · [details](todo/T-042-crm-and-statistics-permissions-entitlements-and-ac.md)
- [ ] T-046 Fix flaky tampered access-token test in identity auth flow — @unassigned · [details](todo/T-046-fix-flaky-tampered-access-token-test-in-identity-a.md)
- [ ] T-048 Narrow app_system inbox uses to SECURITY DEFINER functions — @unassigned · [details](todo/T-048-narrow-app-system-inbox-uses-to-security-definer-f.md)
- [ ] T-049 Inbox dead letters in the UI, OAuth flow purge and page release on disconnect — @unassigned · [details](todo/T-049-inbox-dead-letters-in-the-ui-oauth-flow-purge-and-.md)
- [ ] T-050 Pin the Hermes version and run a live hermes-runtime acceptance probe — @unassigned · [details](todo/T-050-pin-the-hermes-version-and-run-a-live-hermes-runti.md)
- [ ] T-051 Move Meta inbox and training docs into the docs structure — @unassigned · [details](todo/T-051-move-meta-inbox-and-training-docs-into-the-docs-st.md)
- [ ] T-052 Sign in to ChatGPT from the Admin LLM page for hermes-runtime — @mrkenknight · [details](todo/T-052-sign-in-to-chatgpt-from-the-admin-llm-page-for-her.md)

## Blocked

- [ ] T-002 Finalize open decisions (domain, data-center location, MVP channels) — @thienlng · blocked: human decision · [details](todo/T-002-finalize-open-decisions.md)

## Done (last 10 — older ones live in todo/done/)

- [x] T-044 Workspace roles, capabilities and CRM object scope — @agent:claude · [details](todo/done/T-044-workspace-roles-capabilities-and-crm-object-scope.md) · #41
- [x] T-043 Workspace members and invitation links — @agent:claude · [details](todo/done/T-043-workspace-members-and-invitation-links.md) · #41
- [x] T-033 CRM auto-assignment distribution policies for Sales and CSKH — @agent:claude · [details](todo/done/T-033-crm-auto-assignment-distribution-policies-for-sale.md) · #41
- [x] T-047 Rebuild bot training and multichannel UI to match Preny screens — @agent:claude-code · [details](todo/done/T-047-rebuild-bot-training-and-multichannel-ui-to-match-.md) · #40
- [x] T-045 Implement Preny bot training and Meta inbox with an isolated Hermes runtime — @agent:codex · [details](todo/done/T-045-implement-preny-bot-training-and-meta-inbox-with-a.md) · #40
- [x] T-032 CRM classification and attribute tags with assignments — @agent:claude · [details](todo/done/T-032-crm-classification-and-attribute-tags-with-assignm.md) · #39
- [x] T-031 CRM sources, pipeline statuses and Sales/CSKH assignment — @agent:claude · [details](todo/done/T-031-crm-sources-pipeline-statuses-and-sales-cskh-assig.md) · #39
- [x] T-030 CRM typed contact filters, table preferences and saved views — @agent:claude · [details](todo/done/T-030-crm-typed-contact-filters-table-preferences-and-sa.md) · #39
- [x] T-029 CRM contact workspace: profile, notes and audit history — @agent:claude · [details](todo/done/T-029-crm-contact-workspace-profile-notes-and-audit-hist.md) · #39
- [x] T-027 Live-backend commerce E2E regression suite — @agent:claude · [details](todo/done/T-027-live-backend-commerce-e2e-regression-suite.md) · #24
