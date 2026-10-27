import type { BulkConversationAction } from '@agent-sales/contracts';
import {
  CalendarX,
  Check,
  Mail,
  MailOpen,
  MoreHorizontal,
  OctagonAlert,
  RotateCcw,
  Star,
  StarOff,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StatusFilter } from '../lib/inbox-list';
import { Hint } from './hint';
import type { FilterMember } from './inbox-filter-popover';

export interface BulkRun {
  action: BulkConversationAction;
  assigneeId?: string | null;
}

/**
 * Meta's "Quản lý" bar: select the rows on screen (never unloaded ones), then one action for all.
 * In Done or Spam the main action is "reopen" instead of "done" / "spam".
 */
export function BulkBar({
  visible,
  selected,
  folder,
  members,
  userId,
  busy,
  onSelectAll,
  onRun,
  onCancel,
}: {
  visible: number;
  selected: number;
  folder: StatusFilter;
  members: readonly FilterMember[];
  userId: string;
  busy: boolean;
  onSelectAll: (all: boolean) => void;
  onRun: (run: BulkRun) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.meta.bulk.${key}`, options ?? {});
  const all = visible > 0 && selected === visible;
  const none = selected === 0;
  const off = busy || none;
  const inQueue = folder === 'open' || folder === 'all';
  const icon = (action: BulkConversationAction, Icon: typeof Check) => (
    <Hint label={tr(action)}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={tr(action)}
        disabled={off}
        onClick={() => onRun({ action })}
      >
        <Icon />
      </Button>
    </Hint>
  );
  return (
    <div
      role="toolbar"
      aria-label={tr('label')}
      className="flex items-center gap-1 border-b bg-muted/40 px-3 py-1.5"
    >
      <Checkbox
        aria-label={tr('selectVisible', { count: visible })}
        checked={all ? true : none ? false : 'indeterminate'}
        disabled={!visible || busy}
        onCheckedChange={(value) => onSelectAll(value === true)}
      />
      <span className="mr-auto pl-1.5 text-xs font-medium tabular-nums" aria-live="polite">
        {tr('selected', { count: selected })}
      </span>
      {inQueue ? icon('resolve', Check) : icon('reopen', RotateCcw)}
      {icon('star', Star)}
      {icon('read', MailOpen)}
      {inQueue ? icon('spam', OctagonAlert) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tr('more')} disabled={off}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => onRun({ action: 'unread' })}>
            <Mail />
            {tr('unread')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRun({ action: 'unstar' })}>
            <StarOff />
            {tr('unstar')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRun({ action: 'clearFollowUp' })}>
            <CalendarX />
            {tr('clearFollowUp')}
          </DropdownMenuItem>
          {inQueue ? (
            <DropdownMenuItem onSelect={() => onRun({ action: 'reopen' })}>
              <RotateCcw />
              {tr('reopen')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onRun({ action: 'resolve' })}>
              <Check />
              {tr('resolve')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{tr('assign')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-64 w-48 overflow-y-auto">
              {userId ? (
                <DropdownMenuItem onSelect={() => onRun({ action: 'assign', assigneeId: userId })}>
                  {t('channelInbox.v2.row.assignMe')}
                </DropdownMenuItem>
              ) : null}
              {members
                .filter((member) => member.userId !== userId)
                .map((member) => (
                  <DropdownMenuItem
                    key={member.userId}
                    onSelect={() => onRun({ action: 'assign', assigneeId: member.userId })}
                  >
                    <span className="truncate">{member.name}</span>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem onSelect={() => onRun({ action: 'assign', assigneeId: null })}>
                {t('channelInbox.v2.row.unassign')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <Hint label={tr('cancel')}>
        <Button variant="ghost" size="icon-sm" aria-label={tr('cancel')} onClick={onCancel}>
          <X />
        </Button>
      </Hint>
    </div>
  );
}
