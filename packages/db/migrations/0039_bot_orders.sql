-- Bot orders and their staff review (spec 2026-10-31 bot orders §5; additive).

-- Orders the bot creates from a conversation; staff review them before handling.
alter table orders add column if not exists conversation_id uuid;
alter table orders add column if not exists review_state text;
alter table orders add column if not exists reviewed_by_user_id uuid;
alter table orders add column if not exists reviewed_by_name text;
alter table orders add column if not exists reviewed_at timestamptz;
alter table orders drop constraint if exists orders_review_state_check;
alter table orders add constraint orders_review_state_check
  check (review_state in ('pending', 'approved'));
-- No cross-module foreign key: the commerce facade validates the conversation.
create index if not exists orders_conversation_idx on orders (workspace_id, conversation_id)
  where conversation_id is not null;
create index if not exists orders_review_pending_idx on orders (workspace_id, created_at desc)
  where review_state = 'pending';
-- Bot orders use `bot:<conversationId>:<amounts_hash>`; staff orders keep sending uuids.
alter table orders alter column client_request_id type text using client_request_id::text;

-- The order the bot summarised and the customer has not confirmed yet (one per conversation).
create table if not exists bot_order_drafts (
  workspace_id uuid not null references workspaces(id),
  conversation_id uuid not null,
  bot_id uuid not null,
  -- Conversation channel; becomes the order source.
  channel text not null,
  -- [{ variantId, sku, qty }]: prices are read again from the catalog on confirm.
  lines jsonb not null,
  recipient jsonb not null,
  note text,
  -- Null: the shop tells the shipping fee later.
  shipping_vnd bigint,
  amounts_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_id, conversation_id),
  constraint bot_order_drafts_bot_fk foreign key (workspace_id, bot_id)
    references bots (workspace_id, id) on delete cascade
);
create index if not exists bot_order_drafts_expiry_idx on bot_order_drafts (workspace_id, expires_at);

alter table bot_order_drafts enable row level security;
alter table bot_order_drafts force row level security;
drop policy if exists bot_order_drafts_tenant on bot_order_drafts;
drop policy if exists bot_order_drafts_system on bot_order_drafts;
create policy bot_order_drafts_tenant on bot_order_drafts for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy bot_order_drafts_system on bot_order_drafts for all to app_system using (true) with check (true);

-- "Chốt đơn" bot settings: off for existing bots; null fee means "Phí ship: shop báo sau".
alter table bots add column if not exists order_taking boolean not null default false;
alter table bots add column if not exists order_shipping_fee_vnd bigint;
alter table bots drop constraint if exists bots_order_shipping_fee_check;
alter table bots add constraint bots_order_shipping_fee_check
  check (order_shipping_fee_vnd is null or order_shipping_fee_vnd >= 0);
