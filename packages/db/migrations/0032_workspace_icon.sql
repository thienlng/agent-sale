-- 0032_workspace_icon: the icon a business shows when it has no logo (T-111).
-- Additive with a default, so older code keeps working while this rolls out.

alter table workspaces add column if not exists icon text not null default 'building';
