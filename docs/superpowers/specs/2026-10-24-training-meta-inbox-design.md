# Bot training and Meta inbox design

Approved scope: owner conversation on 2026-10-24, including explicit authorization to execute autonomously for two hours.

## Boundaries

Razpi keeps NestJS/TypeScript for bot configuration, training data, Meta connections, conversations and permissions. Python/Hermes owns model/tool execution behind a private authenticated bridge. The bridge takes explicit tenant/bot/context data, never reads another project's database, and returns replies only; delivery remains controlled by NestJS. Preserve existing providers as explicit alternatives rather than silently changing configured routing. A new runtime process and its replacement port are recorded in an ADR.

## User experience

Follow Preny's observed bot sidebar: home, products, instructions, information/FAQ, integrations, media, settings, quick replies and history; show test chat alongside training. Keep Razpi brand tokens and existing responsive shell. Inbox provides channel/filter list, conversation list, messages/composer and customer detail/notes/actions. Facebook and Instagram are the live implementation targets; remaining connectors are visibly unavailable. Reuse existing commerce APIs; do not invent working CRM actions.

## Data and delivery

All business records carry workspace_id and forced RLS, all HTTP routes use existing authentication/workspace membership. OAuth state is bound to workspace/provider/user and one-use; tokens are sealed server-side and never returned. Meta webhooks verify signatures and deduplicate messages. Staff sends pause bot execution; stale model responses cannot overtake human control. Failed/unknown sends expose status rather than blindly duplicate delivery.

## Hermes

Reuse the existing Hermes installation without importing booking-specific villa tools or real credentials. A private service with a small versioned request/response schema isolates the runtime. Tool allowlists, bounded context, timeout, request IDs and missing-auth handling are enforced. Existing subscription code is a technical reference, not proof of commercial eligibility or unlimited quota. No automatic paid fallback.

## Verification

Unit/HTTP tests cover successful flows, validation, permission denial and cross-tenant access. Use synthetic fixtures and fake provider transports for automated tests. Browser QA covers layout, loading/empty/error states and the key CRUD/send/takeover paths. Independent review checks important correctness/security issues. Live Meta consent, webhook registration and subscription inference are reported separately when credentials or owner interaction are required.
