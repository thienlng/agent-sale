import { Check, ChevronDown, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FilterMember } from './inbox-filter-popover';

/** Searchable member picker for the conversation owner, with "Giao cho tôi" and "Bỏ giao". */
export function AssigneeMenu({
  assigneeId,
  members,
  loading,
  userId,
  disabled,
  onAssign,
}: {
  assigneeId: string | null;
  members: readonly FilterMember[];
  loading: boolean;
  userId: string;
  disabled: boolean;
  onAssign: (assigneeId: string | null) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.v2.header.assignee.${key}`, options ?? {});
  const [open, setOpen] = useState(false);
  const current = assigneeId ? members.find((m) => m.userId === assigneeId) : undefined;
  const label = assigneeId ? (current?.name ?? t('channelInbox.assigned')) : tr('none');
  function pick(next: string | null) {
    setOpen(false);
    if (next !== assigneeId) onAssign(next);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={tr('label', { name: label })}
          className="max-w-44 min-w-0"
        >
          {current ? (
            <span
              aria-hidden
              className="grid size-4 shrink-0 place-items-center rounded-full bg-primary-soft text-[9px] font-semibold text-primary"
            >
              {(Array.from(current.name.trim())[0] ?? '?').toUpperCase()}
            </span>
          ) : (
            <UserRound />
          )}
          <span className="truncate">{label}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={tr('search')} />
          <CommandList>
            <CommandEmpty>{loading ? tr('loading') : tr('empty')}</CommandEmpty>
            <CommandGroup>
              {userId && assigneeId !== userId ? (
                <CommandItem value={`__me ${tr('me')}`} onSelect={() => pick(userId)}>
                  {tr('me')}
                </CommandItem>
              ) : null}
              {assigneeId ? (
                <CommandItem value={`__none ${tr('unassign')}`} onSelect={() => pick(null)}>
                  {tr('unassign')}
                </CommandItem>
              ) : null}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {members.map((member) => (
                <CommandItem
                  key={member.userId}
                  value={`${member.name} ${member.userId}`}
                  onSelect={() => pick(member.userId)}
                >
                  <span className="truncate">{member.name}</span>
                  {member.userId === userId ? (
                    <span className="text-xs text-muted-foreground">({tr('you')})</span>
                  ) : null}
                  {member.userId === assigneeId ? <Check className="ml-auto size-4" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
