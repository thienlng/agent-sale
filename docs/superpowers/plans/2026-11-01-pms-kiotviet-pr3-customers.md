# PMS integration with KiotViet — PR 3 (customers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KiotViet customers appear in the Rapiz CRM, matched by phone and kept up to date. New Rapiz customers with a phone are created in KiotViet, and pushed orders carry the KiotViet customer id.

**Architecture:** `crm` gains link columns on `contacts` and a `CONTACT_SYNC_FACADE`: upsert by external id, then by phone; unlink; claim contacts to push; mark pushed; release. `integration` adds:
- a `customer_import` job (a full import when "Đồng bộ khách hàng" is turned on, plus an incremental pass in each reconcile);
- `customer.update` / `customer.delete` webhooks;
- a contact push scan. The push first looks the phone up in KiotViet and adopts an existing customer, so it never creates a duplicate.

The order push from PR 2 switches from an inline customer to find-or-create plus `customerId`. The web enables the switch and shows a KiotViet badge on linked customers.

**Spec:** `docs/superpowers/specs/2026-11-01-pms-kiotviet-design.md` §1.4, §4.4 (crm methods), §6.5, §7 (customer on orders); ADR-017. This branch, `feat/pms-kiotviet-customers`, is stacked on PR 2 (`feat/pms-kiotviet-orders`, #106).

## Global Constraints

- **Workspace and repo rules:**
  - Work in the worktree `/home/kenknight/Workspace/agent-sale-kiotviet`, on branch `feat/pms-kiotviet-customers`.
  - Never touch `/home/kenknight/Workspace/agent-sale`.
  - Don't bind ports 3000/3001/4000/5173.
  - Follow `AGENTS.md`, `.agents/rules/*.md` and `docs/ARCHITECTURE.md`.
  - Use Conventional Commits with a lowercase subject, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Update docs with the code.
- **Module boundaries:** `integration` imports only `modules/crm/api/**` and `modules/commerce/api/**`. `crm` never imports integration.
- **Migration:** use the next free number after checking `origin/main` and open branches. 0041 is taken by the lodging PR #103, so it is use `0051_contacts_external_link.sql` (0050 is PR 2; lodging owns 0041–0043).
  - Add `contacts.external_source text`, `contacts.external_id text`, plus `check ((external_id is null) = (external_source is null))`.
  - Add a unique index `(workspace_id, external_source, external_id) where external_id is not null`.
  - Add a built-in CRM source with key `kiotviet` (name "KiotViet"), seeded like the other built-in sources.
- **PII (rule 07):** customer names, phones, emails and addresses are PII. Never log them, never put them in sync-log params, and never return them in errors. Log ids and counts only.
- **Source-of-truth rule (owner decision):** linked contacts are not locked in CRM, because sales staff keep editing notes, status and owners. When KiotViet changes a linked customer, it overwrites the KiotViet-owned fields: name, phone, email, address, birthday and gender. The CRM form shows a hint "Đồng bộ từ KiotViet — sửa trên KiotViet để giữ thay đổi" on those fields. A KiotViet delete unlinks the contact; it never archives or deletes the Rapiz customer.
- **KiotViet customers API:**
  - `GET /customers` takes `lastModifiedFrom`, `pageSize` ≤ 100, `currentItem`, `includeRemoveIds`, `contactNumber`.
  - `GET /customers/{id}`.
  - `POST /customers` takes `name`, `contactNumber`, `address`, `email`, `branchId`.
  - Field names that are not documented are listed under "Still to verify".

---

### Task 1: CRM — contact link columns and the contact sync facade

**Files:**
- `packages/db/migrations/00NN_contacts_external_link.sql` and `packages/db/src/schema/crm.ts`
- `crm/api/contact-sync.facade.ts` (`CONTACT_SYNC_FACADE`)
- `crm/application/contact-sync.service.ts`
- store port and Drizzle implementation
- contracts: `ContactDto.external` and `ContactSummary.external` (`{ source, id } | null`, `.nullable().default(null)`)
- `crm/MODULE.md`
- tests: a DB integration spec and unit specs

**Interfaces:**
```ts
export interface ExternalContactInput { externalId: string; name: string; phone: string | null; email: string | null; address: string | null; birthday: string | null; gender: 'male' | 'female' | null }
export interface ContactSyncFacade {
  upsertExternalContact(ws, source: 'kiotviet', c: ExternalContactInput): Promise<{ contactId: string; created: boolean; matchedBy: 'external' | 'phone' | 'new' } | { skipped: 'no_identity' }>;
  unlinkExternalContacts(ws, source, externalIds: string[]): Promise<number>;
  claimContactsForPush(ws, source, since: Date, limit: number): Promise<Array<{ id: string; name: string; phoneE164: string; email: string | null; address: string | null }>>;
  markContactPushed(ws, contactId: string, source, externalId: string): Promise<void>;
  releaseExternalSource(ws, source): Promise<number>;
  linkedContactCount(ws, source): Promise<number>;
  /** The KiotViet customer id of a Rapiz contact, if linked. */
  externalIdOf(ws, source, contactId: string): Promise<string | null>;
}
```
**Rules:**
- **Match order:**
  1. external id;
  2. otherwise the oldest live contact with that normalized phone (`normalizeAnyPhone`) that has no link;
  3. otherwise create.
- **Creating a contact:** source key `kiotviet`, auto-assignment applies, history and events as for any create (actor null). A record with no usable name, phone or email is skipped.
- **Updates:** write only the changed KiotViet-owned fields. Each change gets a history entry and emits `crm.contact.updated.v1`. `version` is bumped, so a stale staff edit answers 409, as it already does today.
- **Locking:** take a per-phone advisory lock, as `upsertLeadByPhone` does, so an import and a lead capture racing on one number never create two contacts.
- **Claiming contacts to push:** eligible contacts have no link, a usable phone, are not archived, and have `created_at >= since`. Claiming is idempotent. Mark claimed contacts in a small `crm_contact_push` state, or reuse `external_source` with `external_id = null`. Since the CHECK forbids that, add a column `external_push_state text` ('pending' | 'failed') in the same migration. Choose one approach and document it.

- [ ] Write the tests first, then implement:
  - match by phone links the existing contact;
  - an external update overwrites name/address and writes history;
  - unlink keeps the customer;
  - concurrent upserts of one phone produce one contact;
  - claiming never returns the same contact twice;
  - RLS isolation.

  Then run the crm tests plus the DB integration spec, typecheck, `pnpm arch`, and commit `feat(crm): contact link to an external PMS and the contact sync facade`.

### Task 2: Integration — customer import, webhooks, push, and orders carry the customer id

**Files:**
- gateway and client: `customers(page)`, `customerById`, `customersByPhone`, `createCustomer`; schemas and the fake server
- `domain/kiotviet-customer.ts` (KiotViet customer → `ExternalContactInput`: phone normalisation, gender mapping)
- `application/customer-sync.ts`, which handles:
  - the `customer_import` job (full, resumable cursor, pages of 100);
  - the incremental customer pass inside reconcile when `syncCustomers` is on;
  - `customer.update` (refetch by id, then upsert) and `customer.delete` (unlink) webhooks;
  - the push scan every 30 s: claim contacts, then for each one `customersByPhone`. If a KiotViet customer exists, adopt it (`markContactPushed`); otherwise `createCustomer` in the order branch, then `markContactPushed`. A failure retries on the job schedule, then the contact is marked failed.
- PR 2's order push: before `createOrder`, resolve the customer. Use the order customer's phone and the contact's `externalIdOf` (if the order has a contact), else search by phone, else create. Then send `customerId` instead of the inline customer, and log `customer_linked`.
- `connection.service.ts`:
  - turning `syncCustomers` on enqueues `customer_import`;
  - the webhook set includes `customer.update` and `customer.delete` when the switch is on;
  - disconnect also runs `CONTACT_SYNC_FACADE.releaseExternalSource`.
- `RUNNABLE_KINDS` gains `customer_import`.
- `counts.customers` comes from `linkedContactCount`.
- Log codes: `customers_synced {count}`, `customer_push_failed` (never with PII).

- [ ] Write the tests first, then implement:
  - mapping;
  - import pages with resume;
  - webhook update and delete;
  - push adopts an existing KiotViet customer by phone (no duplicate);
  - an order push uses `customerId`;
  - toggling the switch enqueues the import and updates the webhook set;
  - disconnect releases contacts.

  Then run the integration tests plus the DB specs, typecheck, `pnpm arch`, and commit `feat(integration): sync KiotViet customers with the CRM`.

### Task 3: Web, e2e and docs

**Changes:**
- Enable "Đồng bộ khách hàng" in the wizard and the settings card, and remove "Sắp có".
- Show a KiotViet badge on customers in the CRM list and the customer detail. Show the field hint on the KiotViet-owned fields of the edit form.
- Show the customer count on the connection view.
- i18n for all new strings, in vi and en.
- e2e: CRM list shows the badge; turning on the switch sends `syncCustomers: true`; check at widths 375 and 1280.
- Docs:
  - `docs/integrations/kiotviet.md`: customer flow, matching rules, and the list of things still to verify;
  - spec §4.4: the exact crm methods, and the no-lock decision;
  - `docs/05`;
  - crm and integration `MODULE.md`.

- [ ] Write the tests first, then implement. `pnpm check` must be green and e2e must pass. Commit `feat(web): KiotViet customers in the CRM and the customer sync switch`.

## Bundle note
The web first-load bundle is at 249.5/250 KB gzip. All new CRM strings go into the lazily loaded `integration` namespace (or a new lazy namespace loaded by the CRM routes), never into `common.json`.
