# TODO — task board

Rules: `.agents/rules/03-task-tracking.md`. One line per task; details in `todo/`. Create tasks with `pnpm todo:new "Title"`. Order within a section = priority. Humans reorder; agents only move their own task between sections.

## In progress

- [ ] T-144 Create businesses from the selector, simplify business settings, fix the settings tab arrows — @agent:claude · [details](todo/T-144-create-businesses-and-simplify-business-settings.md)
- [ ] T-142 Let another business connect a removed page — @agent:claude · [details](todo/T-142-let-another-business-connect-a-removed-page.md)
- [ ] T-143 Answer with sales-agent@9 and the business profile — @agent:claude · [details](todo/T-143-answer-with-sales-agent-9-and-the-business-profile.md)
- [ ] T-122 Fix the responsive layout-preference e2e that times out on main — @agent:claude · [details](todo/T-122-fix-the-responsive-layout-preference-e2e-that-time.md)
- [ ] T-141 Backfill bot profiles from placeholders and drop untouched seed content — @agent:claude · [details](todo/T-141-backfill-bot-profiles-from-placeholders.md)
- [ ] T-140 Split reply guidance into personality, situations and system rules — @agent:claude · [details](todo/T-140-split-reply-guidance-into-personality-and-situations.md)
- [ ] T-139 Business profile form on the bot information page — @agent:claude · [details](todo/T-139-business-profile-form-on-the-bot-information-page.md)
- [ ] T-138 Render the business profile and reply style for the model; prompt sales-agent@9 — @agent:claude · [details](todo/T-138-render-the-business-profile-for-the-model.md)
- [ ] T-137 Store a structured business profile and reply style per bot — @agent:claude · [details](todo/T-137-store-a-structured-business-profile-per-bot.md)
- [ ] T-136 Prefer the Facebook full display name for inbox customers — @agent:claude · [details](todo/T-136-prefer-the-facebook-full-display-name-for-customers.md)
- [ ] T-135 Normalize escaped line breaks in generated sales replies — @agent:claude · [details](todo/T-135-normalize-escaped-line-breaks-in-generated-sales-replies.md)
- [ ] T-134 Route dashboard hot reload WebSockets to the web server — @agent:claude · [details](todo/T-134-route-dashboard-hot-reload-websockets-to-the-web-s.md)
- [ ] T-133 Remove pages from platform integrations — @agent:claude · [details](todo/T-133-remove-pages-from-platform-integrations.md)
- [ ] T-112 Move product management to its own top-level navigation group — @agent:claude · [details](todo/T-112-move-product-management-to-its-own-top-level-navig.md) · PR #83
- [ ] T-114 Clean up bot navigation: hide the image library and rename channel integrations — @agent:claude · [details](todo/T-114-clean-up-bot-navigation-hide-the-image-library-and.md) · PR #83
- [ ] T-113 Show per-bot statistics on the bot training home — @agent:claude · [details](todo/T-113-show-per-bot-statistics-on-the-bot-training-home.md) · PR #83
- [ ] T-124 Integrate the lane A account PRs onto current main — @agent:claude · [details](todo/T-124-integrate-the-lane-a-account-prs-onto-current-main.md) · A1 merged in PR #82; A2, A3 pending
- [ ] T-106 Bring Facebook comment threads into the inbox — @agent:claude · [details](todo/T-106-bring-facebook-comment-threads-into-the-inbox.md) · PR #73

## Next

- [ ] T-115 Redesign the appearance preferences panel — @agent:claude · [details](todo/T-115-redesign-the-appearance-preferences-panel.md) · mockup awaiting review
- [ ] T-045 Email verification at signup (ACC-01) and verified-email invitations — @unassigned · [details](todo/T-045-email-verification-at-signup-acc-01-and-verified-e.md)

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
- [ ] T-042 CRM and statistics permissions, entitlements and acceptance suite — @unassigned · [details](todo/T-042-crm-and-statistics-permissions-entitlements-and-ac.md)
- [ ] T-046 Fix flaky tampered access-token test in identity auth flow — @unassigned · [details](todo/T-046-fix-flaky-tampered-access-token-test-in-identity-a.md)
- [ ] T-048 Narrow app_system inbox uses to SECURITY DEFINER functions — @unassigned · [details](todo/T-048-narrow-app-system-inbox-uses-to-security-definer-f.md)
- [ ] T-049 Inbox dead letters in the UI, OAuth flow purge and page release on disconnect — @unassigned · [details](todo/T-049-inbox-dead-letters-in-the-ui-oauth-flow-purge-and-.md)
- [ ] T-050 Pin the Hermes version and run a live hermes-runtime acceptance probe — @unassigned · [details](todo/T-050-pin-the-hermes-version-and-run-a-live-hermes-runti.md)
- [ ] T-051 Move Meta inbox and training docs into the docs structure — @unassigned · [details](todo/T-051-move-meta-inbox-and-training-docs-into-the-docs-st.md)
- [ ] T-058 Notification preferences and reminder offsets (ADM-03) — @unassigned · [details](todo/T-058-notification-preferences-and-reminder-offsets-adm-.md)
- [ ] T-059 Plan purchase history, invoices and payment approval states (ADM-05) — @unassigned · [details](todo/T-059-plan-purchase-history-invoices-and-payment-approva.md)
- [ ] T-060 AI and ZBS credit wallets, ledgers and vouchers (ADM-06) — @unassigned · [details](todo/T-060-ai-and-zbs-credit-wallets-ledgers-and-vouchers-adm.md)
- [ ] T-061 Affiliate onboarding, referral reporting and commissions (ADM-07) — @unassigned · [details](todo/T-061-affiliate-onboarding-referral-reporting-and-commis.md)
- [ ] T-062 Support tickets with department routing and attachments (ADM-08) — @unassigned · [details](todo/T-062-support-tickets-with-department-routing-and-attach.md)
- [ ] T-063 Advanced Google connector and capability-aware settings navigation (ADM-09) — @unassigned · [details](todo/T-063-advanced-google-connector-and-capability-aware-set.md)
- [ ] T-066 Fix flaky MetaInboxProcessor test: reply arriving while the previous one is generated — @unassigned · [details](todo/T-066-fix-flaky-metainboxprocessor-test-reply-arriving-w.md)
- [ ] T-079 Add business selection and switching across sessions — @unassigned · [details](todo/T-079-add-business-selection-and-switching-across-sessio.md)
- [ ] T-080 Let each bot sell a chosen part of the business catalog — @unassigned · [details](todo/T-080-manage-shops-and-their-catalog-and-bot-association.md)
- [ ] T-088 Link CRM customers to bots and conversations — @unassigned · [details](todo/T-088-link-crm-customers-to-business-shop-bot-and-conver.md)
- [ ] T-089 Centralize customer tags and statuses in customer settings — @unassigned · [details](todo/T-089-centralize-customer-tags-and-statuses-in-customer-.md)
- [ ] T-091 Move subscription and message quota ownership to the account — @unassigned · [details](todo/T-091-move-subscription-and-message-quota-ownership-to-t.md)
- [ ] T-094 Validate the cross-business review milestone end to end — @unassigned · [details](todo/T-094-validate-the-cross-business-review-milestone-end-t.md)
- [ ] T-119 Reconcile historical and cross-branch task ID aliases before account integration — @unassigned · [details](todo/T-119-reconcile-historical-and-cross-branch-task-id-alia.md)
- [ ] T-125 Count bot home statistics by the answering bot instead of its current pages — @unassigned · [details](todo/T-125-count-bot-home-statistics-by-the-answering-bot-ins.md)

## Blocked

- [ ] T-093 Scope business settings and bot defaults to the selected industry — @agent:codex · [details](todo/T-093-scope-business-settings-and-bot-defaults-to-the-se.md) · blocked: partial: business industry increment delivered; account billing separation awaits T-092/T-091 · PR #77 (industry increment)

- [ ] T-082 Unify channel assignment and bulk bot filters — @agent:codex · [details](todo/T-082-unify-channel-assignment-and-bulk-bot-filters.md) · PR #64 · blocked: partial: channel assignment delivered; shop eligibility awaits T-077/T-078/T-080

- [ ] T-081 Redesign portfolio and business statistics entry screens — @agent:codex · [details](todo/T-081-redesign-portfolio-and-business-statistics-entry-s.md) · PR #70 · blocked: partial: business dashboards delivered; shop statistics await T-077/T-078/T-080

- [ ] T-092 Add account-level plans and aggregated usage settings — @agent:codex · [details](todo/T-092-add-account-level-plans-and-aggregated-usage-setti.md) · blocked: T-079/T-091: account billing ownership and authorized allowance/usage/reset APIs

- [ ] T-087 Filter the multichannel inbox by shop bot and channel scope — @agent:codex · [details](todo/T-087-filter-the-multichannel-inbox-by-shop-bot-and-chan.md) · blocked: T-078/T-080: authorized shop attribution, bot history semantics and server filter/count/pagination contracts

- [ ] T-002 Finalize open decisions (domain, data-center location, MVP channels) — @thienlng · blocked: human decision · [details](todo/T-002-finalize-open-decisions.md)

## Done (last 10 — older ones live in todo/done/)

- [x] T-132 Filter the inbox by bot and activity time and drop saved filters — @agent:claude · [details](todo/done/T-132-filter-the-inbox-by-bot-and-activity-time-and-drop.md) · main ff5a996
- [x] T-078 Add account persistence and bot attribution with safe backfills — @agent:claude · [details](todo/done/T-078-add-account-business-and-shop-persistence-with-saf.md) · PR #82
- [x] T-077 Define account business ownership and migration contracts — @agent:claude · [details](todo/done/T-077-define-account-business-shop-ownership-and-migrati.md) · PR #82
- [x] T-123 Switch the site and dashboard typography to Space Grotesk with JetBrains Mono accents — @agent:claude · [details](todo/done/T-123-switch-the-site-and-dashboard-typography-to-space-.md) · main
- [x] T-121 Move the marketing site into apps/site and link it with the dashboard — @agent:claude · [details](todo/done/T-121-move-the-marketing-site-into-apps-site-and-link-it.md) · main 1620f83
- [x] T-120 Move the account menu to the header as a compact Facebook-style panel — @agent:claude · [details](todo/done/T-120-move-the-account-menu-to-the-header-as-a-compact-f.md) · main 1620f83
- [x] T-118 Split responsive route coverage into independently timed cases — @agent:codex · [details](todo/done/T-118-split-responsive-route-coverage-into-independently.md) · PR #77
- [x] T-117 Reconcile lane B delivery and remaining integration dependencies — @agent:codex · [details](todo/done/T-117-reconcile-lane-b-delivery-and-remaining-integratio.md) · PR #77
- [x] T-110 Require settings.manage to change fanpage comment automation settings — @agent:codex · [details](todo/done/T-110-require-settings-manage-to-change-fanpage-comment-.md) · PR #77
- [x] T-076 Reduce integration initial bundle below 250 KB — @agent:codex · [details](todo/done/T-076-reduce-integration-initial-bundle-below-250-kb.md) · PR #64
- [x] T-083 Move fanpage management into the bot workspace navigation — @agent:codex · [details](todo/done/T-083-move-fanpage-management-into-the-bot-workspace-nav.md) · PR #64
