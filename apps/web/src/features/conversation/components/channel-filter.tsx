import type { MetaProvider } from '@agent-sales/contracts';
import { ChevronDown, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CHANNEL_FILTERS } from '../lib/inbox-list';
import { ProviderMark } from './customer-avatar';

/** "Tất cả kênh chat" dropdown; channels we do not support yet are listed but disabled. */
export function ChannelFilter({
  value,
  onChange,
}: {
  value: MetaProvider | 'all';
  onChange: (value: MetaProvider | 'all') => void;
}) {
  const { t } = useTranslation();
  const ti = (key: string) => t(`channelInbox.inbox.${key}`);
  const label = value === 'all' ? ti('allChannels') : ti(`channels.${value}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${ti('channelFilter')}: ${label}`}>
          {label}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          onSelect={() => onChange('all')}
          className={cn(value === 'all' && 'font-semibold text-primary')}
        >
          <Inbox />
          {ti('allChannels')}
        </DropdownMenuItem>
        {CHANNEL_FILTERS.map(({ key, available }) =>
          available && (key === 'facebook' || key === 'instagram') ? (
            <DropdownMenuItem
              key={key}
              onSelect={() => onChange(key)}
              className={cn(value === key && 'font-semibold text-primary')}
            >
              <ProviderMark provider={key} className="text-primary" />
              {ti(`channels.${key}`)}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={key} disabled>
              <span className="size-4" aria-hidden />
              {ti(`channels.${key}`)}
              <span className="ml-auto text-xs text-muted-foreground">{ti('comingSoon')}</span>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
