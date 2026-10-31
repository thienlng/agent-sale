-- Products each bot reply saw, so the next turn can keep them in focus (additive).
alter table ai_runs add column if not exists product_ids jsonb not null default '[]'::jsonb;
create index if not exists ai_runs_conversation_recent_idx on ai_runs (workspace_id, conversation_id, created_at desc)
  where conversation_id is not null;
