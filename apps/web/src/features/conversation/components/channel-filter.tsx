import type { ChannelConnectionDto, ChannelProvider, MetaProvider } from '@agent-sales/contracts';
import { ChevronDown, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ListState } from '../lib/inbox-list';
import { ProviderMark } from './customer-avatar';

const LIVE: readonly MetaProvider[] = ['facebook', 'instagram'];
const SOON = ['zalo', 'tiktok', 'website', 'lazada'] as const;

/** Always-visible channel switch next to the tabs; pages are listed when a shop has several. */
export function ChannelFilter({
  state,
  onState,
  channels,
}: {
  state: Pick<ListState, 'provider' | 'channelId'>;
  onState: (patch: Partial<ListState>) => void;
  channels: readonly ChannelConnectionDto[];
}) {
  const { t } = useTranslation();
  const ti = (key: string) => t(`channelInbox.inbox.${key}`);
  const page = channels.find((c) => c.id === state.channelId);
  const label = page
    ? page.name
    : state.provider === 'all'
      ? ti('allChannels')
      : ti(`channels.${state.provider}`);
  const active = state.provider !== 'all' || state.channelId !== 'all';
  const current = (provider: MetaProvider | 'all', channelId = 'all') =>
    state.provider === provider && state.channelId === channelId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${ti('channelFilter')}: ${label}`}
          className={cn('ml-auto h-7 max-w-36 px-2 text-xs', active && 'text-primary')}
        >
          {page || state.provider !== 'all' ? (
            <ProviderMark provider={page?.provider ?? (state.provider as ChannelProvider)} />
          ) : null}
          <span className="truncate">{label}</span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onSelect={() => onState({ provider: 'all', channelId: 'all' })}
          className={cn(current('all') && 'font-semibold text-primary')}
        >
          <Inbox />
          {ti('allChannels')}
        </DropdownMenuItem>
        {LIVE.map((provider) => {
          const pages = channels.filter((c) => c.provider === provider);
          return [
            <DropdownMenuItem
              key={provider}
              onSelect={() => onState({ provider, channelId: 'all' })}
              className={cn(current(provider) && 'font-semibold text-primary')}
            >
              <ProviderMark provider={provider} className="text-primary" />
              {ti(`channels.${provider}`)}
            </DropdownMenuItem>,
            // One page needs no sub-choice; several pages of a channel can be picked one by one.
            ...(pages.length > 1
              ? pages.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={() => onState({ provider: 'all', channelId: c.id })}
                    className={cn('pl-7', current('all', c.id) && 'font-semibold text-primary')}
                  >
                    <span className="truncate">{c.name}</span>
                  </DropdownMenuItem>
                ))
              : []),
          ];
        })}
        <DropdownMenuSeparator />
        {SOON.map((key) => (
          <DropdownMenuItem key={key} disabled>
            <span className="size-4" aria-hidden />
            {ti(`channels.${key}`)}
            <span className="ml-auto text-xs text-muted-foreground">{ti('comingSoon')}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
