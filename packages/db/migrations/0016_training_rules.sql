-- T-070: instruction rules can be switched off and grouped. Additive: columns with defaults, so
-- code deployed before this migration keeps working (it never reads or writes them).
alter table training_items add column if not exists enabled boolean not null default true;
alter table training_items add column if not exists section text not null default 'general';
alter table training_items drop constraint if exists training_items_section_check;
alter table training_items add constraint training_items_section_check
  check (section in ('general', 'after_order'));
