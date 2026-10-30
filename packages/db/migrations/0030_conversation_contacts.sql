-- T-088 / ADR-012. A conversation can point at one CRM customer of its own business, and the CRM
-- remembers every bot that talked with a customer. Additive only; the backfill below links the
-- website conversations that already captured a lead.

-- Target of the composite key below: a conversation can only point at a customer of its workspace.
create unique index contacts_workspace_id_unique on contacts(workspace_id, id);

alter table conversations add column contact_id uuid;
alter table conversations
  add constraint conversations_contact_fk foreign key (workspace_id, contact_id)
  references contacts(workspace_id, id) on delete set null (contact_id);
create index conversations_contact_idx on conversations(workspace_id, contact_id)
  where contact_id is not null;

-- Every bot that answered a conversation linked to the customer. History: kept when a page moves
-- to another bot and when the bot is deleted (no key to bots, like analytics facts).
create table contact_bots (
  workspace_id uuid not null references workspaces(id),
  contact_id uuid not null,
  bot_id uuid not null,
  first_seen_at timestamptz not null default now(),
  primary key (workspace_id, contact_id, bot_id),
  constraint contact_bots_contact_fk foreign key (workspace_id, contact_id)
    references contacts(workspace_id, id) on delete cascade
);
create index contact_bots_bot_idx on contact_bots(workspace_id, bot_id);
alter table contact_bots enable row level security;
alter table contact_bots force row level security;
create policy contact_bots_tenant on contact_bots for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy contact_bots_system on contact_bots for all to app_system using (true) with check (true);

-- Website conversations that captured a phone already know their customer (`data.lead.contactId`).
update conversations cv
   set contact_id = (cv.data -> 'lead' ->> 'contactId')::uuid
 where cv.contact_id is null
   and cv.data -> 'lead' ->> 'contactId' is not null
   and exists (
     select 1 from contacts ct
      where ct.workspace_id = cv.workspace_id
        and ct.id = (cv.data -> 'lead' ->> 'contactId')::uuid
   );
insert into contact_bots (workspace_id, contact_id, bot_id, first_seen_at)
select workspace_id, contact_id, bot_id, min(created_at)
  from conversations
 where contact_id is not null and bot_id is not null
 group by workspace_id, contact_id, bot_id
on conflict do nothing;
