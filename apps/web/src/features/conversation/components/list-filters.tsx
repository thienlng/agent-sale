import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type StatusFilter = 'open' | 'resolved' | 'all';
export type ModeFilter = 'bot' | 'human' | 'all';

/** Status and reply-mode filters, tucked behind a "Bộ lọc" popover. */
export function ListFilters({
  status,
  mode,
  onStatus,
  onMode,
}: {
  status: StatusFilter;
  mode: ModeFilter;
  onStatus: (value: StatusFilter) => void;
  onMode: (value: ModeFilter) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const active = (status !== 'open' ? 1 : 0) + (mode !== 'all' ? 1 : 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={tr('inbox.filters')}>
          <SlidersHorizontal />
          {active ? <span className="text-xs text-primary">{active}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="inbox-status" className="text-xs">
            {tr('status')}
          </Label>
          <Select value={status} onValueChange={(value) => onStatus(value as StatusFilter)}>
            <SelectTrigger id="inbox-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr('allStatuses')}</SelectItem>
              <SelectItem value="open">{tr('open')}</SelectItem>
              <SelectItem value="resolved">{tr('resolved')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inbox-mode" className="text-xs">
            {tr('replyMode')}
          </Label>
          <Select value={mode} onValueChange={(value) => onMode(value as ModeFilter)}>
            <SelectTrigger id="inbox-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr('allModes')}</SelectItem>
              <SelectItem value="bot">{tr('botMode')}</SelectItem>
              <SelectItem value="human">{tr('human')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
