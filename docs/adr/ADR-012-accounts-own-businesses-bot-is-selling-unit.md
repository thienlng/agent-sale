# ADR-012: Accounts own businesses; the bot is the selling unit

- Status: Proposed
- Date: 2026-10-28
- Decision makers: product owner (Tùng), maintainer (thienlng); drafted by @agent:claude for T-077

## Context

The cofounder review (docs/handoffs/2026-10-26-cofounder-review-plan.md) asks for:

- one commercial owner above several businesses, each business with one industry;
- one message allowance shared by all of an owner's businesses;
- switching between businesses from the avatar menu, as in common SaaS workspace switchers;
- several bots per business, each selling part of a shared catalog.

On 2026-10-28 the user settled the open product points:

- **There is no shop entity.** The model is account → business → bot → channels.
- The catalog is business-owned and each bot chooses its products.
- The billable unit is an AI reply delivered to the customer, counted once across retries.
- When the allowance is exhausted, the bot stops and hands the conversation to staff.

Current code (inventory of 2026-10-28):

- The workspace is at once the business, the RLS boundary (ADR-004) and the billing unit: `subscriptions` has `workspace_id` as its primary key.
- No account or shop concept exists.
- Conversations and analytics facts carry the channel but not the bot. Reassigning a page to another bot therefore moves the page's history to the new bot.
- `channel_connections.bot_id` has no foreign key.
- AI catalog lookups (`CatalogFacade`) are workspace-wide.
- Messages are not metered.

## Decision

### 1. Entities

- **Business = workspace.** Nothing is renamed. `workspace_id` stays the tenant key, RLS is unchanged, and every tenant table keeps its policies.
- **`accounts`** is a global table, like `users`: `id` (UUIDv7), `name`, `status` (`active` | `suspended`), `created_by_user_id`, `created_at`, `updated_at`.
- **`account_members`** is a global table: `account_id`, `user_id`, `role` (`owner` | `billing`), `status` (`active` | `removed`), with a unique key on (`account_id`, `user_id`). An account always has at least one active owner.
- **`workspaces.account_id`** points to the account that owns and pays for the business. It is `NOT NULL` once the backfill is done. One account owns many businesses; a business belongs to exactly one account.
- **No shop table.** The bot is the selling unit, and bots already carry `workspace_id`.

The global tables are read and written only by a new `account` backend module, through `app_system` with a repository that always filters by the authenticated user's account membership. This is the same pattern as the membership lookup in `workspace.directory.ts`. The tenant role has no grant on them. ADR-004 gets an amendment listing this use.

### 2. Access

- **Business data access is unchanged:** an active `members` row for (workspace, user), then the role's capabilities, then RLS.
- **Paying for a business never grants access to it.** Account roles do not imply business membership. A business member never sees the account's other businesses unless they are also a member there.
- **The creator of a business becomes its `owner` member,** as today. That is how an account owner normally has access to the businesses they create.
- **Account roles cover account-level actions only:**
  - `owner`: manage the plan, create businesses under the account, manage account members, rename the account.
  - `billing`: view plan and usage, change the plan.
- **Account-level reads:**
  - The account's business list returns names and industries only, and requires account membership.
  - Usage per business (T-091) returns counts only, and also requires account membership.
  - Business content — statistics, conversations, contacts — still requires business membership (T-081 portfolio rule).
- **Moving a business to another account** is out of scope for v1. It is an operator command (CLI, audited) only.

### 3. Signup and business creation

- **Signup** creates the user, then an account (the user becomes its owner), then the first business under that account.
- **`POST /workspaces`** accepts an optional `accountId`, and the caller must be an `owner` of that account. When it is omitted:
  - use the user's only owned account;
  - if the user owns no account (for example invited staff starting their own business), create one for them;
  - if the user owns several accounts, reject with 400 and ask them to choose.
- **There are no quantity limits** on businesses or bots (T-091 removes the unused `channels.max` and similar caps).

### 4. The bot is the selling unit

- **Catalog.**
  - Products stay business-owned.
  - `bots.catalog_mode` is `all` (default, today's behavior) or `selected`.
  - `bot_products(workspace_id, bot_id, product_id)` lists the selection, with composite foreign keys to `bots(workspace_id, id)` and `products(workspace_id, id)`, and RLS.
  - `CatalogFacade` lookups take the bot.
  - A product created from a bot's screen is created in the business catalog and selected for that bot.
  - Price and stock are shared; there is no per-bot price.
- **Channel ↔ bot consistency.** `channel_connections` gets a composite foreign key (`workspace_id`, `bot_id`) → `bots(workspace_id, id)` with `ON DELETE SET NULL (bot_id)`. This makes a channel bound to another workspace's bot impossible.
- **Attribution at event time.**
  - `message.received` and `reply.completed` outbox payloads gain an optional `botId`: the bot bound to the channel when the event happened.
  - `analytics_facts.bot_id` stores it.
  - Conversation metrics accept a `bots` filter.
  - `conversations.bot_id` holds the bot currently answering, for inbox and CRM filters. It is taken from the channel's binding on each inbound message, so a rebind reaches a conversation with its next message. Deleting the bot clears it. Rewriting every conversation of a page at rebind time would make `channel` depend on `conversation`, a module cycle.
  - History therefore stays with the bot that answered it. The bot home statistics (T-113, lane B PR) switch from the page filter to the bot filter.

### 5. Billing ownership (implemented by T-091)

- **Subscriptions move from workspace to account.** The effective entitlement of a business is resolved through its `account_id`.
- **Billable event.** A `reply.completed` with status `sent` for an AI reply, keyed by the reply's outbound idempotency key, so retries and supersedes count once. Human, inbound, echo and playground messages are not billed. `ai_runs` is not the meter.
- **Counting.** Usage is counted per account per subscription cycle, in the account's timezone.
- **Reservation.** Reserve before generating, capture on send, release on failure. This keeps concurrent replies from exceeding the allowance.
- **Exhaustion.** The bot stops and hands off, the customer gets the configurable "staff will reply soon" message, and the dashboard shows a banner (docs/08).
- **Financial history.** Ledger and financial history are never rewritten (ADR-008).

### 6. Routes and navigation

| Situation | Destination |
|---|---|
| After login, 0 businesses | `/app/welcome` (create a business) |
| After login, 1 business, or a remembered one | `/app/analytics` (business home, T-081) |
| After login, ≥2 businesses and none remembered | `/app/select-business` |
| Avatar menu | Current account; businesses grouped by account; "Create business"; "Account and plan" (`/app/account`) |
| Sidebar selector (T-081) | Stays; same switch hook |
| Logo | `/app/overview` (all accessible businesses) |
| `/app/account/{plan,usage,members}` | Account-level screens (T-091/T-092); require account membership |
| Deep link to another business's object | No business id in URLs. The API answers 404; the client reloads bootstrap and shows the safe screen. Explicit `?redirect=` after login still works. |

Switching keeps the T-081 guarantees: tenant captured per request, in-flight queries cancelled, cache removed, route content remounted. It now also exists in the avatar menu, which reverses the "only in the sidebar" note in docs/analytics.md.

### 7. Contracts (examples)

```jsonc
// GET /bootstrap
{ "user": { … },
  "accounts":    [{ "accountId": "a1", "name": "Lan's company", "role": "owner" }],
  "memberships": [{ "workspaceId": "b1", "workspaceName": "Lan Fashion", "industry": "fashion",
                    "accountId": "a1", "role": "owner" }] }

// POST /workspaces
{ "name": "Lan Homestay", "industry": "hotel", "accountId": "a1" }

// GET /accounts/a1/businesses   (account members only; names and industries, no content)
{ "data": [{ "workspaceId": "b1", "name": "Lan Fashion", "industry": "fashion" }, …] }

// PATCH /bots/{id}
{ "catalogMode": "selected", "productIds": ["p1", "p2"] }

// POST /analytics/query (conversation metrics)
{ "metrics": ["messages.inbound"], "filters": { "bots": ["bot-1"] }, … }
```

### 8. Migration, backfill and rollback (implemented by T-078)

1. **Expand (additive, no locks on large tables).**
   - Create `accounts` and `account_members`.
   - Add nullable `workspaces.account_id`.
   - Add a unique key on `bots(workspace_id, id)`.
   - Add nullable `conversations.bot_id` and `analytics_facts.bot_id`.
   - Add `bots.catalog_mode` with default `all` and create `bot_products` with RLS. T-078 ships the rest of this step as migration 0028; these two come with T-080, which first uses them.
   - Add the channel → bot composite foreign key as `NOT VALID`.
2. **Backfill.** An idempotent operator command, `account:backfill [--dry-run]`:
   - one account per distinct `workspaces.owner_user_id`, named after the owner, with an `owner` account member;
   - set `account_id` on every workspace;
   - set `conversations.bot_id` and `analytics_facts.bot_id` from the channel's current binding. An analytics rebuild replays old events without a bot, so the command is run again after one. Past facts of pages already reassigned keep the current bot; this is a known approximation, reported per workspace.
   - The report lists what is never guessed: workspaces without an active owner member, owners that are deleted users, channels bound to a missing or foreign bot (they are unbound, not re-pointed), and subscription conflicts for T-091.
3. **Contract.** Once the report is clean:
   - `workspaces.account_id` becomes `NOT NULL`;
   - the channel and conversation foreign keys are validated;
   - code that reads `account_id` is deployed.
4. **Rollback.**
   - Before step 3: deploy the previous code; the new columns and tables are unused.
   - After step 3: roll the code back and keep the columns.
   - Nothing is dropped until T-091 has moved subscriptions and been accepted.

### 9. Access fixture

Accounts:

- **X**, owned by Lan: business B1 (fashion, bots F1 and F2) and business B2 (hotel, bot H1).
- **Y**, owned by Minh: business B3 (education, bot E1).

Hoa is a `sales` member of B1 and B3. Long is `billing` on account X and a member of no business.

| Actor | Request | Result |
|---|---|---|
| Lan | B1 or B2 data; account X plan, usage and business list | allowed |
| Lan | B3 data; account Y anything | forbidden (404) |
| Hoa | B1 and B3 data, within the sales role | allowed |
| Hoa | B2 data; account X or Y plan, usage or business list | forbidden: Hoa is a member, not a payer |
| Hoa | switcher | lists B1 and B3 only, grouped under X and Y |
| Long | account X plan and usage | allowed |
| Long | any data of B1 or B2 | forbidden: paying gives no access |
| Minh | channel of B3 bound to F1 | rejected by the foreign key |
| Minh | analytics filter `bots: [F1]` in B3 | empty under RLS, no error leak |
| F2 in `selected` mode | AI catalog lookup | only F2's products; F1's selection and B2/B3 products never appear |
| Usage of B1 and B2 | billing | consumes account X's single allowance; B3 consumes Y's |

## Options considered

- **Rename workspace to account.** Rejected: it would merge payer and business. It would weaken the RLS boundary or force every member onto every business.
- **Separate shop entity between business and bot.** Rejected by the product owner on 2026-10-28; bots carry the selling scope.
- **Account-level RLS with a second GUC (`app.account_id`).** Rejected for now. Account rows are few and read by one module, so a second tenant dimension in every policy is not worth it. Revisit if account-wide queries over tenant tables appear.
- **Attribute history through the channel's current bot only.** Rejected: reassignment silently rewrites history.

## Consequences

- **New module `account`** (generated with `pnpm gen module account`) owns accounts, account members, and later account billing ownership.
- **Docs to update with the implementing tasks:**
  - ADR-004: amendment for the `app_system` use in the account module.
  - docs/05: new tables and columns; §9 list of global tables.
  - docs/08: the account owns the subscription; messages are the only commercial capacity.
  - docs/09: account roles.
  - docs/17: business = workspace, no shop.
  - docs/03: new routes.
  - docs/analytics.md: bot dimension; switching also in the avatar menu.
- **Lane B's T-082 and T-087** filter by bot instead of shop.
- **Open questions for the product owner** (they do not block T-078):
  1. Keep or remove the seat limit (`members.max`), the only limit enforced today.
  2. Several paid subscriptions under one new account: proposed rule is to keep the highest plan with the latest period end, report the others for manual handling, and change no money automatically.
  3. Free allowance and cycle per account (today 1,000 messages / 14 days per workspace on paper).
  4. Is the `billing` account role needed in v1, or is `owner` enough?
