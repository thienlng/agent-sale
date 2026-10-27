-- T-102: how many messages a website visitor has sent (drives "ask for a phone number after N
-- messages"). Additive: existing rows start at 0.
alter table webchat_visitors add column message_count integer not null default 0;
