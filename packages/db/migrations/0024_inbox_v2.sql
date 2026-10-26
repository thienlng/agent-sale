-- Inbox v2 (T-073): index columns on conversations so tabs, filters and counts run in SQL.
-- `data` stays the document and the source of the DTO; the columns are derived from it on every
-- save by the conversation store. Deploys must be atomic: the new store and the new columns go
-- out together, because code from before this migration writes only `data` and would leave the
-- columns (and so the list, tabs and counts) stale.
-- Safe to run again: values the document already carries are kept, malformed ones become null/0.

alter table conversations
  add column if not exists unread_count integer not null default 0,
  add column if not exists awaiting_since timestamptz,
  add column if not exists last_read_at timestamptz,
  add column if not exists assignee_id uuid,
  add column if not exists mode text,
  add column if not exists status text,
  add column if not exists customer_phone text,
  add column if not exists created_at timestamptz not null default now();

-- Casts that return null instead of failing on malformed document values.
create or replace function pg_temp.safe_ts(v text) returns timestamptz
language plpgsql immutable as $$
begin
  return v::timestamptz;
exception when others then
  return null;
end $$;
create or replace function pg_temp.safe_uuid(v text) returns uuid
language plpgsql immutable as $$
begin
  return v::uuid;
exception when others then
  return null;
end $$;

with stats as (
  select
    c.id,
    c.workspace_id,
    (select m.data ->> 'sender' from conversation_messages m
      where m.workspace_id = c.workspace_id and m.conversation_id = c.id
      order by m.created_at desc, m.id desc limit 1) as last_sender,
    (select max(m.created_at) from conversation_messages m
      where m.workspace_id = c.workspace_id and m.conversation_id = c.id
        and m.data ->> 'direction' = 'outbound') as last_outbound_at,
    (select min(m.created_at) from conversation_messages m
      where m.workspace_id = c.workspace_id and m.conversation_id = c.id) as first_message_at
  from conversations c
),
derived as (
  select
    s.id,
    s.last_sender,
    least(c.updated_at, coalesce(s.first_message_at, c.updated_at)) as created_at,
    -- Rows that already carry the field keep it (a re-run must not undo later activity).
    case
      when c.data ? 'awaitingSince' then pg_temp.safe_ts(c.data ->> 'awaitingSince')
      -- Waiting means the newest message is the customer's and the conversation is open; the
      -- wait started at the first customer message after our last outbound one.
      when s.last_sender = 'customer' and coalesce(c.data ->> 'status', 'open') = 'open' then (
        select min(m.created_at) from conversation_messages m
        where m.workspace_id = s.workspace_id and m.conversation_id = s.id
          and m.data ->> 'direction' = 'inbound'
          and (s.last_outbound_at is null or m.created_at > s.last_outbound_at))
    end as awaiting_since,
    case when c.data ->> 'unreadCount' ~ '^[0-9]{1,9}$'
      then (c.data ->> 'unreadCount')::integer else 0 end as unread_count
  from stats s join conversations c on c.id = s.id
)
update conversations c set
  unread_count = d.unread_count,
  awaiting_since = d.awaiting_since,
  last_read_at = pg_temp.safe_ts(c.data ->> 'lastReadAt'),
  assignee_id = pg_temp.safe_uuid(c.data ->> 'assigneeId'),
  mode = c.data ->> 'mode',
  status = c.data ->> 'status',
  customer_phone = nullif(c.data ->> 'customerPhone', ''),
  created_at = d.created_at,
  data = c.data || jsonb_build_object(
    'unreadCount', d.unread_count,
    'awaitingSince', case when d.awaiting_since is null then null
      else to_char(d.awaiting_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'lastMessageSender', coalesce(c.data ->> 'lastMessageSender', d.last_sender, 'customer'),
    'createdAt', coalesce(c.data ->> 'createdAt',
      to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    -- The legacy single note becomes the first entry of the notes timeline.
    'notes', case
      when c.data ? 'notes' then c.data -> 'notes'
      when coalesce(c.data ->> 'note', '') <> '' then jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'authorId', null,
        'authorName', '',
        'text', c.data ->> 'note',
        'createdAt', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      else '[]'::jsonb end
  )
from derived d
where d.id = c.id;

create index if not exists conversation_unread_idx
  on conversations (workspace_id, updated_at) where unread_count > 0;
create index if not exists conversation_waiting_idx
  on conversations (workspace_id, awaiting_since) where awaiting_since is not null;
create index if not exists conversation_assignee_idx
  on conversations (workspace_id, assignee_id) where assignee_id is not null;
