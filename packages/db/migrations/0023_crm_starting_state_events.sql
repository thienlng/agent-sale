-- 0023_crm_starting_state_events: the owners and status customers started with, as outbox events
-- (T-040). Before M4b, creating a customer emitted `crm.contact.assigned.v1` only for an
-- auto-assigned Sales and `crm.contact.created.v1` carried no status, so statistics saw customers
-- with a hand-picked owner as unowned (Sales could see colleagues' customers in drilldowns) and old
-- customers as having no status. These events fill that gap in the outbox itself, so a rebuild keeps
-- it. The starting value is the `from` side of the earliest change, or the current value when it
-- never changed. Marked published: they describe the past and are not for other consumers.

-- The earliest change per customer and kind (and role), in one pass over the outbox.
create temporary table first_contact_change on commit drop as
select distinct on (aggregate_id, type, coalesce(payload->>'role', ''))
  aggregate_id as contact_id, type, payload->>'role' as role, payload
from outbox_events
where type in ('crm.contact.assigned.v1', 'crm.contact.status_changed.v1')
order by aggregate_id, type, coalesce(payload->>'role', ''), id;

create temporary table contact_starting_state on commit drop as
select
  c.workspace_id,
  c.id as contact_id,
  to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
  case when fs.contact_id is not null then (fs.payload->>'fromUserId')::uuid else c.sales_user_id end
    as sales_user_id,
  case when fc.contact_id is not null then (fc.payload->>'fromUserId')::uuid else c.care_user_id end
    as care_user_id,
  case
    when cs.contact_id is not null then null
    when st.contact_id is not null then (st.payload->>'fromStatusId')::uuid
    else c.status_id
  end as status_id
from contacts c
left join first_contact_change fs
  on fs.contact_id = c.id and fs.type = 'crm.contact.assigned.v1' and fs.role = 'sales'
left join first_contact_change fc
  on fc.contact_id = c.id and fc.type = 'crm.contact.assigned.v1' and fc.role = 'care'
left join first_contact_change st
  on st.contact_id = c.id and st.type = 'crm.contact.status_changed.v1'
left join (
  select distinct aggregate_id as contact_id from outbox_events
  where type = 'crm.contact.created.v1' and payload->>'statusId' is not null
) cs on cs.contact_id = c.id;

insert into outbox_events (workspace_id, type, aggregate_type, aggregate_id, payload, published_at)
select s.workspace_id, 'crm.contact.assigned.v1', 'contact', s.contact_id,
  jsonb_build_object('workspaceId', s.workspace_id, 'contactId', s.contact_id, 'actorUserId', null,
    'occurredAt', s.occurred_at, 'role', r.role, 'fromUserId', null, 'toUserId', r.owner),
  now()
from contact_starting_state s
cross join lateral (values ('sales', s.sales_user_id), ('care', s.care_user_id)) as r(role, owner)
where r.owner is not null;

insert into outbox_events (workspace_id, type, aggregate_type, aggregate_id, payload, published_at)
select s.workspace_id, 'crm.contact.initial_status.v1', 'contact', s.contact_id,
  jsonb_build_object('workspaceId', s.workspace_id, 'contactId', s.contact_id, 'actorUserId', null,
    'occurredAt', s.occurred_at, 'statusId', s.status_id),
  now()
from contact_starting_state s
where s.status_id is not null;
