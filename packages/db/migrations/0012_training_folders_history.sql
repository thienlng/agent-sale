-- T-047: media folders and restorable training history. Additive; existing rows keep their meaning.
alter table training_items drop constraint if exists training_items_kind_check;
alter table training_items
  add constraint training_items_kind_check check (kind in ('scenario', 'quick_reply', 'media', 'media_folder'));
-- A media item may sit in a folder (itself a training item of kind media_folder).
alter table training_items add column folder_id uuid references training_items(id) on delete cascade;
create index training_items_folder_idx on training_items (folder_id) where folder_id is not null;

alter table training_history drop constraint if exists training_history_kind_check;
alter table training_history
  add constraint training_history_kind_check
  check (kind in ('scenario', 'quick_reply', 'media', 'media_folder', 'faq', 'settings'));
-- Who made the change (display name snapshot), the changed fields, and the item before the change.
alter table training_history add column actor text not null default '';
alter table training_history add column changes jsonb not null default '[]'::jsonb;
alter table training_history add column snapshot jsonb;
