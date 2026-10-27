import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatDay, initials } from '../lib/integrations';
import { ProviderGlyph } from './platform-icon';

const STATUS_CLASS: Record<ChannelConnectionDto['status'], string> = {
  connected: 'border-success/40 bg-success-soft text-success',
  disabled: 'border-border bg-muted text-muted-foreground',
  disconnected: 'border-destructive/30 bg-destructive-soft text-destructive',
  reauth_required: 'border-warning/40 bg-warning-soft text-warning',
};

/** Facebook pages expose a public picture; everything else falls back to initials. */
function PageAvatar({ connection: c }: { connection: ChannelConnectionDto }) {
  const [failed, setFailed] = useState(false);
  const src =
    c.provider === 'facebook' && !failed
      ? `https://graph.facebook.com/${encodeURIComponent(c.externalId)}/picture?type=square`
      : null;
  return (
    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(c.name)
      )}
    </span>
  );
}

export function ConnectionCard({
  connection: c,
  checked,
  onCheckedChange,
  botName,
  showBot,
  canReconnect,
  onReconnect,
  disabled = false,
}: {
  connection: ChannelConnectionDto;
  disabled?: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  botName: string | null;
  showBot: boolean;
  canReconnect: boolean;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  const ti = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.${key}`, options ?? {});
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors',
        checked && 'border-primary/50 bg-primary-soft/30',
      )}
    >
      <Checkbox
        className="mt-4"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={ti('selectPage', { name: c.name })}
      />
      <PageAvatar connection={c} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="truncate font-semibold">{c.name}</p>
          <Badge variant="outline" className={STATUS_CLASS[c.status]}>
            {ti(`status.${c.status}`)}
          </Badge>
        </div>
        <p className="truncate text-xs">{ti('externalId', { id: c.externalId })}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ProviderGlyph provider={c.provider} className="size-3.5" />
          {ti('integratedOn', { date: formatDay(c.createdAt) })}
        </p>
        {showBot ? (
          <p className="text-xs text-muted-foreground">
            {botName ? ti('botName', { name: botName }) : ti('noBot')}
          </p>
        ) : null}
      </div>
      {c.status !== 'connected' ? (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-primary"
          disabled={!canReconnect}
          aria-label={`${t('channelInbox.reconnect')}: ${c.name}`}
          title={t('channelInbox.reconnect')}
          onClick={onReconnect}
        >
          <RefreshCw />
        </Button>
      ) : null}
    </li>
  );
}
