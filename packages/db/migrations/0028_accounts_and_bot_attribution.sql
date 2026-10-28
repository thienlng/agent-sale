-- T-078 / ADR-012 step 1 (expand). Accounts own businesses (workspaces); the bot is the selling unit.
-- Additive only: new global tables, nullable columns and NOT VALID keys. Existing rows stay valid and
-- existing code keeps working. The `account-backfill` CLI fills the new columns; a later contract
-- migration makes workspaces.account_id NOT NULL and validates the keys.

-- Global: the commercial owner of one or more businesses. app_system only (like users).
create table accounts (
  id uuid primary key,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table account_members (
  account_id uuid not null references accounts(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner', 'billing')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (account_id, user_id)
);
create index account_members_user_idx on account_members(user_id) where status = 'active';
revoke all on accounts, account_members from app_tenant;
grant select, insert, update, delete on accounts, account_members to app_system;

-- The account that owns and pays for the business. NOT NULL after the backfill (contract step).
alter table workspaces add column account_id uuid references accounts(id);
create index workspaces_account_idx on workspaces(account_id);

-- Target of the composite keys below: a bot can only be referenced from its own workspace.
create unique index bots_workspace_id_unique on bots(workspace_id, id);

-- A channel can only be bound to a bot of the same workspace. NOT VALID: checked for new and updated
-- rows now; existing rows are checked by the backfill and validated in the contract step.
alter table channel_connections
  add constraint channel_connections_bot_fk foreign key (workspace_id, bot_id)
  references bots(workspace_id, id) on delete set null (bot_id) not valid;

-- The bot currently answering the conversation (inbox and CRM filters). Updated on rebind.
alter table conversations add column bot_id uuid;
alter table conversations
  add constraint conversations_bot_fk foreign key (workspace_id, bot_id)
  references bots(workspace_id, id) on delete set null (bot_id) not valid;

-- The bot bound to the channel when the fact happened. History: no key, never re-pointed.
alter table analytics_facts add column bot_id uuid;
