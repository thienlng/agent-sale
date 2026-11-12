-- 0078_meta_data_deletion: Meta's data deletion request callback (docs/07 "Data deletion
-- callback"). Additive and backward compatible.
--
-- 1. channel_connections.meta_user_hash: who connected the page through Facebook Login, as the
--    SHA-256 hex of `facebook:<app-scoped user id>` (never the id itself). Null for pages connected
--    before this migration, Instagram Login and website chat. Cleared when the page is removed.
alter table channel_connections add column if not exists meta_user_hash text;
create index if not exists channel_connections_meta_user_idx
  on channel_connections (meta_user_hash) where meta_user_hash is not null;

-- 2. meta_data_deletion_requests: global, app_system only (written by apps/webhook, processed by
--    the worker, read by the public status route). No personal data: the user hash is kept only
--    while the request is pending (it makes a repeated callback answer the same code) and cleared
--    when the request completes.
create table if not exists meta_data_deletion_requests (
  id uuid primary key,
  confirmation_code text not null unique
    constraint meta_data_deletion_requests_code_check check (confirmation_code ~ '^[A-Za-z0-9]{16,64}$'),
  user_hash text,
  status text not null default 'pending'
    constraint meta_data_deletion_requests_status_check check (status in ('pending', 'completed')),
  connections_removed integer not null default 0,
  attempts integer not null default 0,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint meta_data_deletion_requests_done_check check (
    (status = 'completed') = (completed_at is not null)
    and (status = 'pending') = (user_hash is not null)
  )
);
create unique index if not exists meta_data_deletion_requests_pending_user_idx
  on meta_data_deletion_requests (user_hash) where status = 'pending';
create index if not exists meta_data_deletion_requests_pending_idx
  on meta_data_deletion_requests (requested_at) where status = 'pending';

revoke all on meta_data_deletion_requests from app_tenant;
grant select, insert, update on meta_data_deletion_requests to app_system;
