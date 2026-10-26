-- 0019_billing_tenant_read_only: a workspace may read its subscription and overrides but never
-- write them; plan changes and overrides are operator (app_system) actions. The tenant RLS policy
-- was `for all`, so without this a tenant-context bug could upgrade its own plan.
revoke insert, update, delete on subscriptions from app_tenant;
revoke insert, update, delete on workspace_entitlement_overrides from app_tenant;
