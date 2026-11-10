-- Website lead capture by email: the address a visitor typed (normalized) and when. Additive and
-- nullable: existing visitors have none.
alter table webchat_visitors add column email text;
alter table webchat_visitors add column email_captured_at timestamptz;
