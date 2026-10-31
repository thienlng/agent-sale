-- Stored summary of the older part of a long conversation (agent harness v2, additive).
create table if not exists conversation_summaries (
  workspace_id uuid not null references workspaces(id),
  conversation_id uuid not null,
  covered_until timestamptz not null,
  summary text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, conversation_id)
);

alter table conversation_summaries enable row level security;
alter table conversation_summaries force row level security;
drop policy if exists conversation_summaries_tenant on conversation_summaries;
drop policy if exists conversation_summaries_system on conversation_summaries;
create policy conversation_summaries_tenant on conversation_summaries for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy conversation_summaries_system on conversation_summaries for all to app_system using (true) with check (true);
