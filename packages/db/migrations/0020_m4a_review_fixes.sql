-- 0020_m4a_review_fixes: follow-ups from the review of M4a (T-064).

-- Shops that existed before billing (0015) had no member limit. Without a subscription row they
-- would fall to the free plan's single seat on upgrade and every pending invitation would fail on
-- accept. Keep them unlimited until an operator puts them on a plan (then delete this override).
insert into workspace_entitlement_overrides (workspace_id, key, value, reason)
select w.id, 'members.max', 'null'::jsonb, 'grandfathered: created before billing (T-064)'
from workspaces w
where w.created_at < (select applied_at from schema_migrations where name = '0015_billing.sql')
  and not exists (select 1 from subscriptions s where s.workspace_id = w.id)
on conflict (workspace_id, key) do nothing;

-- The audit trail is append-only for every application role, not only the tenant one (T-054):
-- the system role may add and read events, never rewrite or delete them.
revoke update, delete on audit_events from app_system;
