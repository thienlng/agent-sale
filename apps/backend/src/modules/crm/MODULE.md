# crm

**Purpose:** the shop's customers — profiles with notes and an audit history, customer sources and pipeline statuses, Sales/CSKH ownership, tag definitions with attribute schemas and their assignments, typed filters and saved views (docs/02 CRM-01..CRM-10; GitHub epic #25, issues #26–#29).

**Owned tables:** `contacts`, `contact_notes`, `contact_history`, `crm_sources`, `crm_statuses`, `crm_tags`, `crm_tag_assignments`, `saved_views` (tenant, forced RLS — migration 0006; schema in `packages/db/src/schema/crm.ts`).

**Public API (`api/`):**

- `CRM_FACADE` → `getContact(workspaceId, contactId)`.
- HTTP (workspace-scoped): `/contacts`, `/contacts/query`, `/contacts/{id}` (+ `/notes`, `/history`, `/tags`), `/tag-assignments/{id}` (+ `/remove`), `/crm/sources`, `/crm/statuses` (+ `/order`), `/crm/tags`, `/crm/assignees`, `/saved-views`. Contracts: `packages/contracts/src/crm/`.
- Events (outbox, same transaction as the change): `crm.contact.created.v1`, `crm.contact.updated.v1`, `crm.contact.status_changed.v1`, `crm.contact.assigned.v1`, `crm.tag.assigned.v1`, `crm.tag.removed.v1`.

**Events consumed:** none yet. Uses the `identity` facade (actor names) and the `workspace` facade (members for assignment, time zone for date filters).

**Invariants:**

- A contact has at least a name, a usable phone or an email. Phones are stored as typed plus E.164 (`normalizeAnyPhone`); an unusable phone is rejected, not stored.
- Edits carry `expectedVersion`; a stale edit answers 409 and writes nothing. Only sent fields change (`null`/"" clears). "Provided at" timestamps are set when a phone/address first appears and are never touched by other edits. The first source is kept once set.
- Every change appends `contact_history` (field → {from, to}) in the same transaction; status and assignment changes get their own entries and events. Notes are separate from the 500-character profile note; editing a note keeps the old body in the history. Notes never message the customer.
- Sources, statuses and tags have stable ids and are archived, never deleted: archived ones stay on existing customers and in history but cannot be newly chosen. Defaults (7 sources, 8 statuses, 3 system tags) are seeded on first use by `key`.
- A customer's status never changes orders (orders have their own status; nothing in this module reads or writes them).
- Sales and CSKH are separate fields; both must be active workspace members when assigned.
- Classification and attribute tags are active at most once per customer (partial unique index): a retried add returns the existing assignment (200) and a retried remove is a no-op, so neither writes a second event. Work tags may repeat. Attribute values are validated on the server against the tag's fields; fields keep key and type forever and options are archived, never removed, so old values stay readable. Assignments record the schema version they were filled with. Contact and conversation scopes are distinct (`scope`).
- One SQL compiler (`contact-filter.sql.ts`) builds the WHERE for rows and the total. Null rule: a customer without a value matches `is_empty` and the negative operators (`neq`, `not_contains`, `not_in`, `has_none`), never a positive one. Duplicate-phone grouping uses the normalized phone and ignores empty phones. Unsupported operators/values answer 400.
- Private saved views exist only for their owner (404 for others); shared views are readable by every member and changeable only by the owner (403).
- Creating a contact is idempotent per `clientRequestId`, also under a race.

**Not yet (later tasks):** tasks/reminders (CRM-05), custom fields, import/merge, files/export/archive, conversation rules, auto-distribution policies, per-role permissions and object scope (every member can use the CRM today), analytics projections.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`; send customer messages from CRM actions.

**No database:** routes answer 503 `UNAVAILABLE`. Test with `test/crm.integration.spec.ts`.

**Test:** `pnpm --filter @agent-sales/backend test -- crm` · integration: `test/crm.integration.spec.ts` · live UI: `apps/web/e2e-live/crm.spec.ts`
