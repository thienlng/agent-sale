import { FolderInput, LayoutGrid, List, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { storage } from '@/lib/storage';

export type ViewMode = 'grid' | 'list';

/** The owner's last grid/list choice, per browser. */
const VIEW_KEY = 'rapiz.lodging.mediaView';
export const savedView = (): ViewMode => (storage.get(VIEW_KEY) === 'list' ? 'list' : 'grid');

/** Grid / list switch for a folder; remembers the choice in this browser. */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={t('lodging.media.viewMode')}
      className="shrink-0"
      value={value}
      onValueChange={(v) => {
        if (v !== 'grid' && v !== 'list') return;
        storage.set(VIEW_KEY, v);
        onChange(v);
      }}
    >
      <ToggleGroupItem value="grid" aria-label={t('lodging.media.viewGrid')}>
        <LayoutGrid aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label={t('lodging.media.viewList')}>
        <List aria-hidden />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** Actions on the selected items of a folder: move to another folder, delete, clear. */
export function SelectionBar({
  count,
  canMove,
  onMove,
  onRemove,
  onClear,
}: {
  count: number;
  canMove: boolean;
  onMove: () => void;
  onRemove: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t('lodging.media.selected', { count })}
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm"
    >
      <span className="font-medium">{t('lodging.media.selected', { count })}</span>
      <Button type="button" size="sm" variant="outline" disabled={!canMove} onClick={onMove}>
        <FolderInput aria-hidden />
        {t('lodging.media.moveTo')}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={onRemove}>
        <Trash2 aria-hidden />
        {t('lodging.media.remove')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClear}>
        {t('lodging.media.clearSelection')}
      </Button>
    </div>
  );
}
