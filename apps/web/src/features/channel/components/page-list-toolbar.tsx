import { Search, Settings2, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** Header of the page list: title, search, bulk actions and "Chọn tất cả". */
export function PageListToolbar({
  bot,
  query,
  onQueryChange,
  selectedCount,
  totalCount,
  editEnabled,
  busy,
  onToggleAll,
  onEdit,
  onDeactivate,
}: {
  bot: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  selectedCount: number;
  totalCount: number;
  editEnabled: boolean;
  busy: boolean;
  onToggleAll: (checked: boolean) => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const { t } = useTranslation();
  const ti = (key: string) => t(`channelInbox.integrations.${key}`);
  const all = totalCount > 0 && selectedCount === totalCount;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{ti(bot ? 'botListTitle' : 'listTitle')}</h2>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={ti('searchPlaceholder')}
            placeholder={ti('searchPlaceholder')}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={all ? true : selectedCount > 0 ? 'indeterminate' : false}
            disabled={!totalCount}
            onCheckedChange={(value) => onToggleAll(value === true)}
          />
          {ti('selectAll')}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!editEnabled || busy} onClick={onEdit}>
            {ti('edit')}
            <Settings2 />
          </Button>
          {!bot ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* A disabled button gets no pointer events; the span carries the tooltip. */}
                  <span tabIndex={0} className="inline-flex">
                    <Button variant="outline" disabled>
                      {ti('sync')}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{ti('comingSoon')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          <Button variant="outline" disabled={!selectedCount || busy} onClick={onDeactivate}>
            <Unplug />
            {ti('deactivate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
