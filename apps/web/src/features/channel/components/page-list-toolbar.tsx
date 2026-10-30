import type { BotDto } from '@agent-sales/contracts';
import { Search, Bot, Trash2, Unplug } from 'lucide-react';
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
  bots,
  assignment,
  onAssignmentChange,
  readOnly,
  canUnassign,
  canRemove,
  onRemove,
}: {
  bot: boolean;
  bots: readonly BotDto[];
  assignment: string;
  onAssignmentChange: (value: string) => void;
  readOnly: boolean;
  canUnassign: boolean;
  /** At least one selected page can be removed (website chat cannot). */
  canRemove: boolean;
  onRemove: () => void;
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
            disabled={busy}
            aria-label={ti('searchPlaceholder')}
            placeholder={ti('searchPlaceholder')}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      {!bot ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="integration-bot-filter">{ti('filterBot')}</Label>
          <select
            id="integration-bot-filter"
            className="h-9 min-w-0 max-w-full rounded-md border bg-background px-3 text-sm"
            value={assignment}
            disabled={busy}
            onChange={(e) => onAssignmentChange(e.target.value)}
          >
            <option value="all">{ti('allBots')}</option>
            <option value="unassigned">{ti('noBot')}</option>
            {bots.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={all ? true : selectedCount > 0 ? 'indeterminate' : false}
            disabled={!totalCount || busy || readOnly}
            onCheckedChange={(value) => onToggleAll(value === true)}
          />
          {ti('selectAll')}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!editEnabled || busy} onClick={onEdit}>
            {ti(bot ? 'choosePages' : 'edit')}
            <Bot />
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
          <Button
            variant="outline"
            disabled={!canUnassign || busy || readOnly}
            onClick={onDeactivate}
          >
            <Unplug />
            {ti('deactivate')}
          </Button>
          {!readOnly ? (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={!canRemove || busy}
              onClick={onRemove}
            >
              <Trash2 />
              {ti('removePage')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
