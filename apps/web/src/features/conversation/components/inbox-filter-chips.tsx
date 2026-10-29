import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { filterChips, removeChip, type FilterChip, type ListState } from '../lib/inbox-list';
import type { FilterBot, FilterChannel, FilterMember, FilterTag } from './inbox-filter-popover';

/** `YYYY-MM-DD` as `DD/MM/YYYY`. */
const dayLabel = (date: string) => date.split('-').reverse().join('/');

/** Active filters as removable chips on one horizontally scrolling line. */
export function InboxFilterChips({
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
  const chips = filterChips(state);
  if (!chips.length) return null;
  const label = (chip: FilterChip): string => {
    const v2 = (key: string, options?: Record<string, unknown>) =>
      t(`channelInbox.v2.${key}`, options ?? {});
    switch (chip.kind) {
      case 'tagsAny':
      case 'tagsAll':
      case 'tagsExclude':
        return v2(`chip.${chip.kind}`, {
          name: tags.find((tag) => tag.id === chip.tagId)?.name ?? v2('chip.unknown'),
        });
      case 'untagged':
        return v2('filter.untagged');
      case 'waiting':
        return v2(`filter.waiting.${state.waiting}`);
      case 'mode':
        return v2(`chip.mode.${state.mode}`);
      case 'assignee':
        return chip.value === 'me' || chip.value === 'none'
          ? v2(`chip.assignee.${chip.value}`)
          : (members.find((m) => m.userId === chip.value)?.name ?? v2('chip.unknown'));
      case 'provider':
        return v2(`filter.channel.${chip.value}`);
      case 'channelId':
        return channels.find((c) => c.id === chip.value)?.name ?? v2('chip.unknown');
      case 'botId':
        return chip.value === 'none'
          ? v2('filter.bot.none')
          : v2('chip.bot', {
              name: bots.find((bot) => bot.id === chip.value)?.name ?? v2('chip.unknown'),
            });
      case 'time':
        if (state.time !== 'custom') return v2(`filter.time.${state.time}`);
        if (state.timeFrom && state.timeTo)
          return v2('chip.timeRange', {
            from: dayLabel(state.timeFrom),
            to: dayLabel(state.timeTo),
          });
        return state.timeFrom
          ? v2('chip.timeFrom', { date: dayLabel(state.timeFrom) })
          : v2('chip.timeTo', { date: dayLabel(state.timeTo) });
      case 'hasPhone':
        return v2(`chip.phone.${state.hasPhone}`);
      case 'status':
        return v2(`filter.status.${state.status}`);
    }
  };
  return (
    <ul
      aria-label={t('channelInbox.v2.list.chipsLabel')}
      className="flex gap-1.5 overflow-x-auto pb-1 whitespace-nowrap [scrollbar-width:thin]"
    >
      {chips.map((chip) => {
        const text = label(chip);
        return (
          <li key={chip.id} className="shrink-0">
            <button
              type="button"
              aria-label={t('channelInbox.v2.list.removeChip', { label: text })}
              onClick={() => onState(removeChip(state, chip))}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-2 py-0.5 text-xs text-primary hover:bg-primary-soft/70"
            >
              {text}
              <X className="size-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
