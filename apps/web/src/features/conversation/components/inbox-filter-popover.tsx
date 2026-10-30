import type { ChannelProvider } from '@agent-sales/contracts';
import { Check, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  activeFilterCount,
  advancedPart,
  customRangeValid,
  DEFAULT_LIST_STATE,
  type ListState,
  type ModeFilter,
  type PhoneFilter,
  type StatusFilter,
  type TimeFilter,
} from '../lib/inbox-list';
import type { WaitingFilter } from '../lib/inbox-v2-types';
import { TagChip } from './tag-chip';

export interface FilterTag {
  id: string;
  name: string;
  color: string;
}
export interface FilterMember {
  userId: string;
  name: string;
}
export interface FilterBot {
  id: string;
  name: string;
}
export interface FilterChannel {
  id: string;
  name: string;
  provider: ChannelProvider;
}

type Group =
  'bot' | 'time' | 'tags' | 'assignee' | 'status' | 'waiting' | 'mode' | 'channel' | 'phone';
/** Bot and time first: the filters sales teams reach for most. */
const GROUPS: readonly Group[] = [
  'bot',
  'time',
  'tags',
  'assignee',
  'status',
  'waiting',
  'mode',
  'channel',
  'phone',
];
type TagMode = 'tagsAny' | 'tagsAll' | 'tagsExclude';
const TAG_MODES: readonly TagMode[] = ['tagsAny', 'tagsAll', 'tagsExclude'];
const TIMES: readonly TimeFilter[] = ['any', 'today', 'yesterday', 'last7', 'last30', 'custom'];

/** Today as `YYYY-MM-DD` in local time, the latest day a custom range can pick. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function groupActive(group: Group, s: ListState): boolean {
  switch (group) {
    case 'bot':
      return s.botId !== 'all';
    case 'time':
      return s.time !== 'any';
    case 'tags':
      return s.untagged || s.tagsAny.length + s.tagsAll.length + s.tagsExclude.length > 0;
    case 'waiting':
      return s.waiting !== DEFAULT_LIST_STATE.waiting;
    case 'mode':
      return s.mode !== 'all';
    case 'assignee':
      return s.assignee !== 'all';
    case 'channel':
      return s.channelId !== 'all';
    case 'phone':
      return s.hasPhone !== 'all';
    case 'status':
      return s.status !== DEFAULT_LIST_STATE.status;
  }
}

function Option({
  selected,
  onSelect,
  kind = 'radio',
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  kind?: 'radio' | 'checkbox';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
        selected && 'font-medium text-primary',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {selected ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
    </button>
  );
}

/**
 * Meta's advanced filter: groups on the left, options on the right. Choices are a draft until
 * "Áp dụng"; "Xóa tất cả" resets the draft and closing discards it. The channel tab, search,
 * queue tab and quick filters live outside and are never touched here.
 */
export function InboxFilterPopover({
  state,
  onState,
  tags,
  members,
  channels,
  bots,
}: {
  state: ListState;
  onState: (patch: Partial<ListState>) => void;
  tags: readonly FilterTag[];
  members: readonly FilterMember[];
  channels: readonly FilterChannel[];
  bots: readonly FilterBot[];
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.v2.filter.${key}`, options ?? {});
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<Group>('bot');
  const [tagMode, setTagMode] = useState<TagMode>('tagsAny');
  const [draft, setDraft] = useState(state);
  const count = activeFilterCount(state);
  const rangeInvalid = draft.time === 'custom' && !customRangeValid(draft.timeFrom, draft.timeTo);
  const filterLabel = t('channelInbox.v2.list.filter');
  const patch = (next: Partial<ListState>) => setDraft((previous) => ({ ...previous, ...next }));
  function openChange(next: boolean) {
    if (next) setDraft(state);
    setOpen(next);
  }

  function toggleTag(id: string) {
    const current = draft[tagMode];
    const adding = !current.includes(id);
    // A tag cannot be both wanted and excluded: choosing it on one side clears the other.
    const conflicts: TagMode[] =
      tagMode === 'tagsExclude' ? ['tagsAny', 'tagsAll'] : ['tagsExclude'];
    const cleared = Object.fromEntries(
      conflicts.map((m) => [m, adding ? draft[m].filter((x) => x !== id) : draft[m]]),
    );
    patch({
      untagged: false,
      ...cleared,
      [tagMode]: adding ? [...current, id] : current.filter((x) => x !== id),
    });
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={count ? t('channelInbox.v2.list.filterActive', { count }) : filterLabel}
          title={filterLabel}
          className={cn('relative shrink-0', count > 0 && 'text-primary')}
        >
          <SlidersHorizontal />
          {count > 0 ? (
            <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-1.5rem))] p-0">
        <div className="flex min-h-64">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label={tr('groupsLabel')}
            className="w-36 shrink-0 space-y-0.5 border-r p-1.5"
          >
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={group === g}
                onClick={() => setGroup(g)}
                className={cn(
                  'flex w-full items-center justify-between gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  group === g && 'bg-muted font-medium',
                )}
              >
                {tr(`groups.${g}`)}
                {groupActive(g, draft) ? (
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                ) : null}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="max-h-72 min-w-0 flex-1 overflow-y-auto p-1.5">
            {group === 'bot' ? (
              <>
                <p className="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">{tr('bot.hint')}</p>
                <Option selected={draft.botId === 'all'} onSelect={() => patch({ botId: 'all' })}>
                  {tr('bot.all')}
                </Option>
                {bots.map((bot) => (
                  <Option
                    key={bot.id}
                    selected={draft.botId === bot.id}
                    onSelect={() => patch({ botId: bot.id })}
                  >
                    <span className="truncate">{bot.name}</span>
                  </Option>
                ))}
                <Option selected={draft.botId === 'none'} onSelect={() => patch({ botId: 'none' })}>
                  {tr('bot.none')}
                </Option>
              </>
            ) : null}
            {group === 'time' ? (
              <>
                <p className="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">{tr('time.hint')}</p>
                {TIMES.map((time) => (
                  <Option
                    key={time}
                    selected={draft.time === time}
                    onSelect={() =>
                      patch(time === 'custom' ? { time } : { time, timeFrom: '', timeTo: '' })
                    }
                  >
                    {tr(`time.${time}`)}
                  </Option>
                ))}
                {draft.time === 'custom' ? (
                  <div className="grid grid-cols-2 gap-2 px-2 pt-1.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="inbox-time-from" className="text-xs">
                        {tr('time.from')}
                      </Label>
                      <Input
                        id="inbox-time-from"
                        type="date"
                        max={draft.timeTo || localToday()}
                        value={draft.timeFrom}
                        onChange={(e) => patch({ timeFrom: e.target.value })}
                        className="h-8 px-2 text-xs"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor="inbox-time-to" className="text-xs">
                        {tr('time.to')}
                      </Label>
                      <Input
                        id="inbox-time-to"
                        type="date"
                        min={draft.timeFrom || undefined}
                        max={localToday()}
                        value={draft.timeTo}
                        onChange={(e) => patch({ timeTo: e.target.value })}
                        className="h-8 px-2 text-xs"
                      />
                    </div>
                    {rangeInvalid ? (
                      <p role="alert" className="col-span-2 text-xs text-destructive">
                        {tr('time.invalid')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {group === 'tags' ? (
              <div className="space-y-1">
                <div role="radiogroup" className="grid grid-cols-3 gap-1 pb-1">
                  {TAG_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={tagMode === m}
                      onClick={() => setTagMode(m)}
                      className={cn(
                        'rounded-md border px-1 py-1 text-[11px] leading-tight hover:bg-muted',
                        tagMode === m && 'border-primary bg-primary-soft text-primary',
                      )}
                    >
                      {tr(m)}
                    </button>
                  ))}
                </div>
                <Option
                  kind="checkbox"
                  selected={draft.untagged}
                  onSelect={() =>
                    patch({
                      untagged: !draft.untagged,
                      ...(draft.untagged ? {} : { tagsAny: [], tagsAll: [], tagsExclude: [] }),
                    })
                  }
                >
                  {tr('untagged')}
                </Option>
                {tags.length ? (
                  tags.map((tag) => (
                    <Option
                      key={tag.id}
                      kind="checkbox"
                      selected={draft[tagMode].includes(tag.id)}
                      onSelect={() => toggleTag(tag.id)}
                    >
                      <TagChip name={tag.name} color={tag.color} />
                    </Option>
                  ))
                ) : (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{tr('noTags')}</p>
                )}
              </div>
            ) : null}
            {group === 'waiting'
              ? (['off', 'longest', 'readNotReplied'] as const).map((w) => (
                  <Option
                    key={w}
                    selected={draft.waiting === w}
                    onSelect={() => patch({ waiting: w as WaitingFilter | 'off' })}
                  >
                    {tr(`waiting.${w}`)}
                  </Option>
                ))
              : null}
            {group === 'mode'
              ? (['all', 'bot', 'human'] as const).map((m) => (
                  <Option
                    key={m}
                    selected={draft.mode === m}
                    onSelect={() => patch({ mode: m as ModeFilter })}
                  >
                    {tr(`mode.${m}`)}
                  </Option>
                ))
              : null}
            {group === 'assignee' ? (
              <>
                {(['all', 'me', 'none'] as const).map((a) => (
                  <Option
                    key={a}
                    selected={draft.assignee === a}
                    onSelect={() => patch({ assignee: a })}
                  >
                    {tr(`assignee.${a}`)}
                  </Option>
                ))}
                {members.map((member) => (
                  <Option
                    key={member.userId}
                    selected={draft.assignee === member.userId}
                    onSelect={() => patch({ assignee: member.userId })}
                  >
                    <span className="truncate">{member.name}</span>
                  </Option>
                ))}
              </>
            ) : null}
            {group === 'channel' ? (
              <>
                <Option
                  selected={draft.channelId === 'all'}
                  onSelect={() => patch({ channelId: 'all' })}
                >
                  {tr('channel.allPages')}
                </Option>
                {channels.map((channel) => (
                  <Option
                    key={channel.id}
                    selected={draft.channelId === channel.id}
                    onSelect={() => patch({ channelId: channel.id })}
                  >
                    <span className="truncate">{channel.name}</span>
                  </Option>
                ))}
              </>
            ) : null}
            {group === 'phone'
              ? (['all', 'yes', 'no'] as const).map((p) => (
                  <Option
                    key={p}
                    selected={draft.hasPhone === p}
                    onSelect={() => patch({ hasPhone: p as PhoneFilter })}
                  >
                    {tr(`phone.${p}`)}
                  </Option>
                ))
              : null}
            {group === 'status'
              ? (['open', 'resolved', 'spam', 'all'] as const).map((s) => (
                  <Option
                    key={s}
                    selected={draft.status === s}
                    onSelect={() => patch({ status: s as StatusFilter })}
                  >
                    {tr(`status.${s}`)}
                  </Option>
                ))
              : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={activeFilterCount(draft) === 0}
            onClick={() => patch(advancedPart(DEFAULT_LIST_STATE))}
          >
            {tr('reset')}
          </Button>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={() => openChange(false)}>
              {tr('close')}
            </Button>
            <Button
              size="sm"
              disabled={rangeInvalid}
              onClick={() => {
                onState(advancedPart(draft));
                setOpen(false);
              }}
            >
              {tr('apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
