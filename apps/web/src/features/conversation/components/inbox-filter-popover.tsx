import { Check, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  activeFilterCount,
  DEFAULT_LIST_STATE,
  type ListState,
  type ModeFilter,
  type PhoneFilter,
  type StatusFilter,
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
export interface FilterChannel {
  id: string;
  name: string;
  provider: 'facebook' | 'instagram';
}

type Group = 'tags' | 'waiting' | 'mode' | 'assignee' | 'channel' | 'phone' | 'status';
const GROUPS: readonly Group[] = [
  'tags',
  'waiting',
  'mode',
  'assignee',
  'channel',
  'phone',
  'status',
];
type TagMode = 'tagsAny' | 'tagsAll' | 'tagsExclude';
const TAG_MODES: readonly TagMode[] = ['tagsAny', 'tagsAll', 'tagsExclude'];

function groupActive(group: Group, s: ListState): boolean {
  switch (group) {
    case 'tags':
      return s.untagged || s.tagsAny.length + s.tagsAll.length + s.tagsExclude.length > 0;
    case 'waiting':
      return s.waiting !== DEFAULT_LIST_STATE.waiting;
    case 'mode':
      return s.mode !== 'all';
    case 'assignee':
      return s.assignee !== 'all';
    case 'channel':
      return s.provider !== 'all' || s.channelId !== 'all';
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

/** One "Lọc" button; a two-column popover: filter groups on the left, their options on the right. */
export function InboxFilterPopover({
  state,
  onState,
  tags,
  members,
  channels,
}: {
  state: ListState;
  onState: (patch: Partial<ListState>) => void;
  tags: readonly FilterTag[];
  members: readonly FilterMember[];
  channels: readonly FilterChannel[];
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.v2.filter.${key}`, options ?? {});
  const [group, setGroup] = useState<Group>('tags');
  const [tagMode, setTagMode] = useState<TagMode>('tagsAny');
  const count = activeFilterCount(state);
  const filterLabel = t('channelInbox.v2.list.filter');

  function toggleTag(id: string) {
    const current = state[tagMode];
    const adding = !current.includes(id);
    // A tag cannot be both wanted and excluded: choosing it on one side clears the other.
    const conflicts: TagMode[] =
      tagMode === 'tagsExclude' ? ['tagsAny', 'tagsAll'] : ['tagsExclude'];
    const cleared = Object.fromEntries(
      conflicts.map((m) => [m, adding ? state[m].filter((x) => x !== id) : state[m]]),
    );
    onState({
      untagged: false,
      ...cleared,
      [tagMode]: adding ? [...current, id] : current.filter((x) => x !== id),
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={count ? t('channelInbox.v2.list.filterActive', { count }) : filterLabel}
          className={cn('shrink-0', count > 0 && 'border-primary/50 text-primary')}
        >
          <SlidersHorizontal />
          {filterLabel}
          {count > 0 ? (
            <span className="grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
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
                {groupActive(g, state) ? (
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
                ) : null}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="max-h-72 min-w-0 flex-1 overflow-y-auto p-1.5">
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
                  selected={state.untagged}
                  onSelect={() =>
                    onState({
                      untagged: !state.untagged,
                      ...(state.untagged ? {} : { tagsAny: [], tagsAll: [], tagsExclude: [] }),
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
                      selected={state[tagMode].includes(tag.id)}
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
                    selected={state.waiting === w}
                    onSelect={() => onState({ waiting: w as WaitingFilter | 'off' })}
                  >
                    {tr(`waiting.${w}`)}
                  </Option>
                ))
              : null}
            {group === 'mode'
              ? (['all', 'bot', 'human'] as const).map((m) => (
                  <Option
                    key={m}
                    selected={state.mode === m}
                    onSelect={() => onState({ mode: m as ModeFilter })}
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
                    selected={state.assignee === a}
                    onSelect={() => onState({ assignee: a })}
                  >
                    {tr(`assignee.${a}`)}
                  </Option>
                ))}
                {members.map((member) => (
                  <Option
                    key={member.userId}
                    selected={state.assignee === member.userId}
                    onSelect={() => onState({ assignee: member.userId })}
                  >
                    <span className="truncate">{member.name}</span>
                  </Option>
                ))}
              </>
            ) : null}
            {group === 'channel' ? (
              <>
                <Option
                  selected={state.provider === 'all' && state.channelId === 'all'}
                  onSelect={() => onState({ provider: 'all', channelId: 'all' })}
                >
                  {tr('channel.all')}
                </Option>
                {(['facebook', 'instagram'] as const).map((p) => (
                  <Option
                    key={p}
                    selected={state.provider === p && state.channelId === 'all'}
                    onSelect={() => onState({ provider: p, channelId: 'all' })}
                  >
                    {tr(`channel.${p}`)}
                  </Option>
                ))}
                {channels.length ? (
                  <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
                    {tr('channel.pages')}
                  </p>
                ) : null}
                {channels.map((channel) => (
                  <Option
                    key={channel.id}
                    selected={state.channelId === channel.id}
                    onSelect={() => onState({ provider: 'all', channelId: channel.id })}
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
                    selected={state.hasPhone === p}
                    onSelect={() => onState({ hasPhone: p as PhoneFilter })}
                  >
                    {tr(`phone.${p}`)}
                  </Option>
                ))
              : null}
            {group === 'status'
              ? (['open', 'resolved', 'all'] as const).map((s) => (
                  <Option
                    key={s}
                    selected={state.status === s}
                    onSelect={() => onState({ status: s as StatusFilter })}
                  >
                    {tr(`status.${s}`)}
                  </Option>
                ))
              : null}
          </div>
        </div>
        {count > 0 ? (
          <div className="flex justify-end border-t p-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onState({
                  ...DEFAULT_LIST_STATE,
                  q: state.q,
                  tab: state.tab,
                })
              }
            >
              {tr('reset')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
