-- Business Brain (ADR-030): the daily evaluation cap `brain.evaluations.daily` is a plan
-- entitlement. Every stored plan version gets the default of 200 evaluations per business per day,
-- so the plan catalog stays a complete entitlement set (admins republish plans from it) and
-- `BillingFacade.limit` reads the real value. Internal shops get `null` (unlimited) through an
-- entitlement override, not through a plan.
update plans
set entitlements = entitlements || jsonb_build_object('brain.evaluations.daily', 200)
where not (entitlements ? 'brain.evaluations.daily');
