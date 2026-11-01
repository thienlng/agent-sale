-- Customers linked to a PMS (ADR-017, PMS PR 3; additive). 0050 is the order push; the lodging
-- series owns 0041–0043.

-- The PMS customer a Rapiz customer is linked to; both set or both null.
alter table contacts add column if not exists external_source text;
alter table contacts add column if not exists external_id text;
-- Creating a Rapiz customer in the PMS: 'pending' while claimed by a push, 'failed' when the PMS
-- refused it. Null otherwise (also once linked). KiotViet is the only source, so the claim carries
-- no source of its own.
alter table contacts add column if not exists external_push_state text;
alter table contacts add column if not exists external_push_at timestamptz;
alter table contacts add column if not exists external_push_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_external_link_check') then
    alter table contacts add constraint contacts_external_link_check
      check ((external_id is null) = (external_source is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contacts_external_push_state_check') then
    alter table contacts add constraint contacts_external_push_state_check
      check (external_push_state is null
        or (external_push_state in ('pending', 'failed') and external_id is null
          and external_push_at is not null));
  end if;
end $$;

-- One Rapiz customer per PMS customer; PMS webhooks look customers up by it.
create unique index if not exists contacts_external on contacts (workspace_id, external_source, external_id)
  where external_id is not null;
-- Phone match of an import: the oldest live, unlinked customer with that phone.
create index if not exists contacts_phone_unlinked_idx on contacts (workspace_id, phone_normalized, created_at)
  where external_id is null and archived_at is null and phone_normalized is not null;
-- The push claim: unlinked, unclaimed customers with a phone, oldest first.
create index if not exists contacts_push_unclaimed_idx on contacts (workspace_id, created_at)
  where external_id is null and external_push_state is null and archived_at is null
    and phone_normalized is not null;
-- Claimed customers by claim age: the scan's stale re-queue (push on) or release (push off).
create index if not exists contacts_push_pending_idx on contacts (workspace_id, external_push_at)
  where external_push_state = 'pending';
