# Meta-style inbox functional specification handoff

Task: T-095. Date: 2026-10-27. Scope: research and documentation only.

## Deliverable and authority

The [Vietnamese BA specification](../business/rapiz-inbox-meta-ba.vi.md) is the authoritative business requirements artifact for product-owner review. Its language and location follow the explicit business-material exception in Rule 01. This English handoff records implementation boundaries and repository references; it does not duplicate or override the requirements.

The user requested a comprehensive specification of the Meta Business Suite Inbox opened in their Chrome profile, for later implementation by Claude. Meta supersedes Pancake as the functional reference for the next design discussion. The product owner has not yet approved proposed defaults, unresolved provider capabilities, or implementation milestones. This document does not start a broad application rewrite.

Read sections 1–3 for scope and interaction principles, 4–12 for requirements, 13 for workflows, 14 for the existing implementation baseline, 15 for acceptance, 16 for decisions and proposed sequencing, and 17 for observation evidence and research limits. Stable INB-prefixed requirement IDs support implementation task slicing and remain distinct from global PRD feature IDs. Evidence labels distinguish visible UI from proposed behavior, conditional capabilities, and existing functionality to preserve.

## Current implementation references

Baseline: main `9265c3c6d0a9a7b0a92b1205819adf57f6d8537e`.

- [Current Meta inbox behavior](../meta-inbox.md): the T-073 updates are important when older design prose disagrees about unread/assignment support.
- [Sales inbox workspace](../18-sales-inbox-workspace.md): compose modes, draft orders, explicit CRM links, safety, saved views and sales workflows.
- [Facebook comment integration](../integrations/facebook-comments.md): provider processing and comment automation; do not assume this implies full Facebook/Instagram comment parity.
- [Tenant and vertical design](../17-multi-tenancy-and-verticals.md): intended hierarchy; actual persistence and shop attribution must be verified with lane A.
- [Channel integrations](../07-channel-integrations.md) and [screen map](../03-screens-and-routes.md): design context, not proof that every listed adapter or route is implemented.
- [Architecture](../ARCHITECTURE.md), [ADRs](../adr/README.md), [performance budgets](../16-performance-and-scale.md): binding implementation rules.

Existing task ownership remains separate:

- T-077–T-080: account/business/shop ownership, persistence, switching and associations.
- T-086: original inbox workflow/visual refinement; its four-person-day estimate covers the earlier limited scope, not this parity inventory.
- T-087: actual shop/bot/channel inbox filters.
- T-088: customer linkage across business, shop, bot and conversation.
- T-089: canonical customer tag/status settings; T-090 fixed concrete tag persistence/value handling and must not regress.
- T-058: notification preferences and reminder offsets; distinguish that from a functioning reminder scheduler.

## Instructions for a later implementation agent

1. Read the task, repository rules, this handoff and the business specification before creating implementation tasks. Do not implement everything under the docs-only T-095 task.
2. Convert the requirement inventory into linked tasks, preserving every requirement as delivered, deferred or blocked with a reason. Do not silently reinterpret “all features” as only the three-column layout.
3. Resolve the section 16 decisions affecting the slice before changing persistence or provider behavior. Proposed defaults are not approved architectural decisions. Architecture or tenancy changes require the repository's ADR workflow.
4. Build a provider capability matrix for the actual connected app, API version, scopes, review status and test account. Separate viewing messages/comments, public replies, private replies, reactions, moderation, delivery/read receipts, media upload, calling and payments. An icon visible inside Meta does not prove third-party API availability.
5. Keep the global sidebar and unrelated screens unchanged. All Inbox queries, counts, search, drafts, media, actions and deep links must follow the sidebar-selected business and authorized channel scope.
6. Preserve current working bot/human takeover, shared read state, required tag values, safe retries, saved views, product inserts and real draft-order creation. Identify enhancements rather than relabeling an existing limited capability as a complete feature.
7. Use synthetic/test conversations for acceptance. Never test outbound messages, bulk deletion, blocking, automations or finance on the owner's live customer thread.
8. For each implementation slice, map requirement IDs to representative success, failure, permission and isolation checks. Run the mandatory gate and fresh-context review before claiming completion. Documentation of a requirement is not evidence its implementation passes.

## Research method and limits

Research used the owner's already-open regular Chrome window through desktop inspection. The isolated Playwright browser was not attached to that profile and was not used as evidence of the authenticated UI. Inspection covered the all-message workspace, advanced filters, local bulk selection, assignment popover, tooltips, availability, customer edit form, customer actions, commerce marker options, settings, automation catalog and the messaging-insights destination. No new message was sent, no ad or automation was published, no call was placed, and no unread thread was intentionally opened.

One accidental immediate-save mutation occurred while inspecting the commerce-status dropdown: a scheduled-appointment marker was selected. It was immediately cleared back to the original empty value and the restoration was visually confirmed. Meta retained an activity entry. The owner was informed in chat. This research must not be described as entirely mutation-free. No attempt was made to delete or conceal the audit event.

Account-specific customer content, profile information, asset identifiers and screenshots are not included in the repository. Temporary local captures were used to inspect controls, not as fixtures or product data. The evidence inventory in the business document records only control-level observations.

Official-source access was attempted on the observation date. The Help Center page redirected to login; the developer private-replies page could not be retrieved through the web tool. Consequently, no exact messaging-window, permission, pricing or rate-limit claim is derived from those pages. The business specification links them as verification targets only. A follow-up investigator must record accessible primary-source evidence before converting conditional provider behavior into a hard requirement. Third-party search results were not used as authority.

Detailed lead-manager screens, task-center internals, per-message menus, saved-reply library/editor internals, custom workflow-builder details and provider-specific comment flows remain unverified. They are explicitly represented in the inventory rather than claimed as fully researched. The spec is ready for review of the observed Inbox core and planning of the conditional investigations; exhaustive Meta-product parity is not certified.

## Verification record

- Business requirements contain stable IDs, workflow examples, separate state dimensions, a capability/decision backlog and acceptance scenarios.
- No application source, migration, configuration, dependency or product string changes are included.
- Formatting, link validation, repository gate and independent QA outcomes are recorded in the T-095 task log as they are completed. A reviewer should consult that log rather than infer that checks passed from this handoff.

Independent review: [BA/QA findings and final verdict](2026-10-27-meta-inbox-spec-qa.md).
