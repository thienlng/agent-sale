import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { Check, Copy, Globe, Settings, Trash2, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatDay } from '../lib/integrations';
import { settingsOf } from '../lib/website';
import { useCopyEmbed } from './website-embed-code';

/** Website variant of the connection card: domains, on/off state and install actions. */
export function WebsiteCard({
  connection: c,
  checked,
  onCheckedChange,
  selectionDisabled,
  botName,
  showBot,
  canManage,
  busy,
  onInstall,
  onSettings,
  onToggle,
  onDisconnect,
}: {
  connection: ChannelConnectionDto;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  selectionDisabled: boolean;
  botName: string | null;
  showBot: boolean;
  canManage: boolean;
  busy: boolean;
  onInstall: () => void;
  onSettings: () => void;
  onToggle: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation();
  const ti = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.${key}`, options ?? {});
  const tw = (key: string, options?: Record<string, unknown>) => ti(`website.${key}`, options);
  const { copied, copy } = useCopyEmbed(c.externalId);
  const enabled = c.status === 'connected';
  const toggleable = c.status === 'connected' || c.status === 'disabled';
  const domains = settingsOf(c.settings).domains;
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
        disabled={selectionDisabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={ti('selectPage', { name: c.name })}
      />
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
        <Globe className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="truncate font-semibold">{c.name}</p>
          <Badge
            variant="outline"
            className={
              enabled
                ? 'border-success/40 bg-success-soft text-success'
                : 'border-border bg-muted text-muted-foreground'
            }
          >
            {enabled
              ? tw('running')
              : c.status === 'disabled'
                ? tw('off')
                : ti(`status.${c.status}`)}
          </Badge>
        </div>
        <p className="truncate text-xs">{tw('domainsLine', { list: domains.join(', ') })}</p>
        <p className="text-xs text-muted-foreground">
          {ti('integratedOn', { date: formatDay(c.createdAt) })}
        </p>
        {showBot ? (
          <p className="text-xs text-muted-foreground">
            {botName ? ti('botName', { name: botName }) : ti('noBot')}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? tw('copied') : tw('copyCode')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onInstall}>
            <BookOpen />
            {tw('installGuide')}
          </Button>
          {canManage ? (
            <>
              <Button variant="ghost" size="sm" onClick={onSettings}>
                <Settings />
                {tw('settingsAction')}
              </Button>
              {toggleable ? (
                <Switch
                  size="sm"
                  checked={enabled}
                  disabled={busy}
                  aria-label={tw('toggleLabel', { name: c.name })}
                  onCheckedChange={onToggle}
                />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                aria-label={`${tw('disconnect')}: ${c.name}`}
                title={tw('disconnect')}
                onClick={onDisconnect}
              >
                <Trash2 />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
