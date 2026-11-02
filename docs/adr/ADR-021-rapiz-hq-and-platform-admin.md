# ADR-021: Rapiz HQ is an ordinary SaaS workspace fed one way from the platform; operators act in the platform admin

- Status: Proposed
- Date: 2026-11-02
- Decision makers: thienlng
- Design and use-case review: [docs/superpowers/specs/2026-11-02-rapiz-hq-saas-design.md](../superpowers/specs/2026-11-02-rapiz-hq-saas-design.md)

## Context

Rapiz is a SaaS company and wants to run its own customers through its SaaS vertical (ADR-020). The facts about those customers live in platform tables that no tenant can read: `users`, `accounts` (ADR-012), `workspaces`, `account_subscriptions`, `message_usage`. Today:

- signup creates a user, an account and a workspace, but no subscription and no trial;
- plans change only through the `workspace-plan` CLI; subscription status and period end are not enforced;
- account, billing and identity publish no events; the only platform-side event, `workspace.workspace.created.v1`, has no consumer;
- the platform admin has one screen, `/admin/llm`.

A review of 33 operator use cases (spec §5) found that the SaaS vertical covers the work before signup (bot capture, statuses, assignment, inbox), and that almost everything after signup is missing on the platform side, not in the CRM.

## Decision

1. **Rapiz HQ is an ordinary `saas` workspace.** No code reads another tenant's data because a workspace is HQ. HQ is named by the env var `RAPIZ_HQ_WORKSPACE_ID`, created once by an operator CLI (`hq-init`). Unset turns the sync off. HQ membership and the platform-admin flag are independent.
2. **One way, by events.** `account`, `billing` and `workspace` write versioned integration events (Zod in `packages/contracts`) to `outbox_events` in the same transaction as the change: `account.account.created.v1`, `account.account.status_changed.v1`, `workspace.workspace.status_changed.v1`, `billing.subscription.changed.v1`, `billing.usage.snapshot.v1` (daily). Payloads carry account-level metadata only, never a tenant's customers, conversations or products. A consumer in the **`saas`** module applies them to HQ through the CRM and SaaS facades. HQ never writes back.
3. **Source of truth (ADR-017 applied).** The platform owns plan, period, status, dates, MRR and usage; in HQ they are read-only (`EXTERNAL_SOURCE`). HQ owns status before signup, notes, tags, owner and conversations. On a linked contact staff may edit the name, not the phone or email (they are the link keys).
4. **Identity mapping.** One HQ contact per account, linked by `contacts.external_source = 'rapiz'`, `external_id = <account_id>`; its `saas_subscriptions` row carries `external_ref = <account_id>`. A new account adopts an unlinked HQ contact matched by phone, then email (the earlier bot lead); otherwise one is created. Phase 1 syncs the account owner only; an HQ sync setting in `/admin` selects the scope (`owner` now, `owner_and_billing` once several people per account are supported).
5. **Reliability.** The consumer is idempotent by event id and ignores events older than the last applied one per account. A nightly reconcile compares `account_subscriptions` and accounts with HQ and repairs drift; `hq-backfill [--dry-run]` links existing accounts once. Logs carry codes and counts, no PII.
6. **Operators act in `/admin`, behind `@PlatformAdmin()`.** Every action needs a reason and writes an audit entry:
   - **plan catalog editor**: name, price per period, entitlements, public/hidden; an edit inserts a new `(code, version)` so current subscribers keep their version;
   - **trial settings**: on/off, trial plan, length in days, plan after the trial (default `free`); no card is asked at signup;
   - set plan and period, extend a trial, entitlement overrides, suspend and reactivate an account;
   - confirm a VietQR bank transfer by hand (first payment method; automatic matching and VNPAY later).
   The CLIs stay for scripted use.
7. **Third-party systems.** Connectors call the other system's API inside `integration` (KiotViet today). Systems calling Rapiz will use Rapiz's own public API and signed webhooks (VRT-10), on the same event contract as decision 2. No vendor schema (KiotViet, Odoo) becomes a Rapiz contract.

## Options considered

1. **A special HQ workspace that reads platform tables directly**: rejected. It needs the system role inside a tenant's request path, breaks RLS isolation, couples HQ screens to platform schema, and leaves no room for HQ's own sales data.
2. **Wait for the public API (VRT-10) and let HQ consume it**: rejected for now. VRT-10 is P2 and large (keys, rate limits, signing, docs); dogfooding would wait months. The event contract is shaped so VRT-10 can reuse it.
3. **Use an external CRM (HubSpot, Odoo) for Rapiz's own customers**: rejected. It defeats dogfooding and needs the same sync anyway.
4. **Edit billing facts from the HQ subscription form**: rejected. Two writers for plan and status; operator actions belong in the audited admin.
5. **Put the consumer in `integration`**: rejected. `integration` is for third-party systems with credentials and webhooks; this is an internal projection.

## Consequences

- New platform work comes first: events, trial, lifecycle enforcement, admin read views and actions. HQ is only as good as these facts.
- `saas` gains an event handler and depends on the `crm` and `saas` facades it already uses; `ContactExternalSource` gains `'rapiz'`.
- Plan edits are append-only versions; reports must group by plan code.
- Support access inside a customer's workspace (impersonation) is out of scope and needs its own ADR.
- Delivery order (spec §7): platform admin + events + plan catalog + trial settings → subscription lifecycle → HQ sync → SaaS vertical v2 → VietQR payments.
