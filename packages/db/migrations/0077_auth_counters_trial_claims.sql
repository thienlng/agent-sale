-- 0077_auth_counters_trial_claims: shared auth limits and one signup trial per person.
-- Both global, app_system only (like users). Additive; the backfill only inserts.

-- Fixed-window counters every API process shares (identity `WindowCounter`): logins per account,
-- code emails per address, code checks per address. The key names an address, so only its sha256
-- is stored. Ended windows are swept by the counter itself.
create table if not exists auth_counters (
  key_hash text primary key,
  count integer not null,
  window_end timestamptz not null
);

create index if not exists auth_counters_window_end_idx on auth_counters (window_end);

revoke all on auth_counters from app_tenant;
grant select, insert, update, delete on auth_counters to app_system;

-- The signup trial goes to the first user of a canonical email (identity `domain/mailbox.ts`,
-- `canonicalMailbox`: lower-cased, `+tag` dropped, and for Gmail the dots too), stored as the
-- sha256 of that canonical form. The user id goes null when the user is deleted, so deleting an
-- account does not hand out a new trial.
create table if not exists trial_claims (
  email_hash text primary key,
  user_id uuid references users (id) on delete set null,
  claimed_at timestamptz not null default now()
);

revoke all on trial_claims from app_tenant;
grant select, insert, update, delete on trial_claims to app_system;

-- Existing users keep their claim: the oldest user of each canonical email.
insert into trial_claims (email_hash, user_id, claimed_at)
select distinct on (canonical)
  encode(sha256(convert_to(canonical, 'UTF8')), 'hex'), id, created_at
from (
  select
    u.id,
    u.created_at,
    case
      when split_part(lower(u.email), '@', 2) in ('gmail.com', 'googlemail.com')
        then replace(split_part(split_part(lower(u.email), '@', 1), '+', 1), '.', '') || '@gmail.com'
      else split_part(split_part(lower(u.email), '@', 1), '+', 1) || '@' || split_part(lower(u.email), '@', 2)
    end as canonical
  from users u
) c
order by canonical, created_at, id
on conflict (email_hash) do nothing;
