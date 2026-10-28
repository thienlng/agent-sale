-- T-080 / ADR-012 §5. The catalog stays business-owned; each bot either sells every active product
-- ('all', the default, so existing bots keep their behaviour) or only the products selected for it.
-- Additive only: a defaulted column, a unique index and a new tenant table.
alter table bots add column catalog_mode text not null default 'all'
  check (catalog_mode in ('all', 'selected'));

-- Target of the composite key below: a selection can only name a product of the same workspace.
create unique index products_workspace_id_unique on products(workspace_id, id);

create table bot_products (
  workspace_id uuid not null references workspaces(id),
  bot_id uuid not null,
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, bot_id, product_id),
  constraint bot_products_bot_fk foreign key (workspace_id, bot_id)
    references bots(workspace_id, id) on delete cascade,
  constraint bot_products_product_fk foreign key (workspace_id, product_id)
    references products(workspace_id, id) on delete cascade
);
create index bot_products_product_idx on bot_products(workspace_id, product_id);
alter table bot_products enable row level security;
alter table bot_products force row level security;
create policy bot_products_tenant on bot_products for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy bot_products_system on bot_products for all to app_system using (true) with check (true);
