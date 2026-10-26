-- 0017_workspace_profile: business profile of a workspace and its private logo (T-056, ADM-02).
-- The logo is stored in Postgres (at most 1 MiB, one per workspace) until object storage is
-- chosen (T-013); it is only ever served through the authorised API route.

alter table workspaces add column if not exists company_name text not null default '';
alter table workspaces add column if not exists business_services text not null default '';
alter table workspaces add column if not exists product_description text not null default '';
alter table workspaces add column if not exists profile_version integer not null default 1;
alter table workspaces add column if not exists profile_updated_by uuid;
alter table workspaces add column if not exists profile_updated_at timestamptz;
alter table workspaces add column if not exists logo_asset_id uuid;

create table if not exists workspace_assets (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  kind text not null check (kind in ('logo')),
  -- png or jpeg only, decided from the bytes, never from the file name or the header
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 1048576),
  width integer not null,
  height integer not null,
  sha256 text not null,
  data bytea not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists workspace_assets_workspace_idx on workspace_assets (workspace_id, kind);

alter table workspace_assets enable row level security;
alter table workspace_assets force row level security;
drop policy if exists workspace_assets_tenant on workspace_assets;
drop policy if exists workspace_assets_system on workspace_assets;
create policy workspace_assets_tenant on workspace_assets for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy workspace_assets_system on workspace_assets for all to app_system using (true) with check (true);
