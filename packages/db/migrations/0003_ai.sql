-- 0003_ai: LLM metering (ai_runs, tenant) and the platform-wide LLM configuration managed by
-- platform admins (llm_providers, llm_tier_routes, global). docs/06 §7, docs/05.

-- ai_runs: one row per LLM turn — metering and "which sources did the bot use". Monthly
-- partitioning and cost columns come with billing (docs/08); playground runs have is_test = true
-- and are never charged.

create table if not exists ai_runs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  bot_id uuid not null references bots(id) on delete cascade,
  conversation_id uuid,
  tier text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cached_tokens integer not null,
  latency_ms integer not null,
  retrieved jsonb not null default '[]'::jsonb,
  outcome text not null,
  guardrail text,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_runs_workspace_idx on ai_runs (workspace_id, created_at);
create index if not exists ai_runs_bot_idx on ai_runs (workspace_id, bot_id, created_at);

alter table ai_runs enable row level security;
alter table ai_runs force row level security;
drop policy if exists ai_runs_tenant on ai_runs;
drop policy if exists ai_runs_system on ai_runs;
create policy ai_runs_tenant on ai_runs for all to app_tenant
  using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid))
  with check (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
create policy ai_runs_system on ai_runs for all to app_system using (true) with check (true);

-- Platform operators (back-office, LLM config). Granted only from the CLI, never through the API.
alter table users add column if not exists is_platform_admin boolean not null default false;

-- Global LLM configuration: which servers exist and which model serves each commercial tier.
-- API keys are stored encrypted by the app (AES-256-GCM, key outside the database).
create table if not exists llm_providers (
  id uuid primary key,
  name text not null unique,
  kind text not null check (kind in ('anthropic', 'openai_compatible')),
  base_url text,
  api_key_cipher text,
  api_key_hint text,
  options jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists llm_tier_routes (
  tier text primary key check (tier in ('basic', 'smart', 'pro', 'neo')),
  provider_id uuid not null references llm_providers(id),
  model text not null,
  effort text check (effort in ('low', 'medium', 'high')),
  fallback_provider_id uuid references llm_providers(id),
  fallback_model text,
  fallback_effort text check (fallback_effort in ('low', 'medium', 'high')),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  check ((fallback_provider_id is null) = (fallback_model is null))
);

-- Platform configuration is not tenant data: only the system role may read or change it.
revoke all on llm_providers, llm_tier_routes from app_tenant;
grant select, insert, update, delete on llm_providers, llm_tier_routes to app_system;
