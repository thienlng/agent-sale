import { Link } from '@tanstack/react-router';
import { CircleAlert, House } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/permissions';

import { useProperties } from '../api/properties';
import { useBotProperties, useSetBotProperties } from '../api/settings';

/**
 * Bot training "Căn & phòng" for a hotel bot: a sells / does not sell switch per place.
 * "Tất cả căn" stores an empty list, which means every place, including new ones.
 */
export function BotProperties({ botId }: { botId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const canEdit = useCan('bots.manage');
  const properties = useProperties();
  const selection = useBotProperties(botId);
  const save = useSetBotProperties();
  const selected = new Set(selection.data ?? []);
  const places = properties.data ?? [];
  const active = places.filter((p) => p.status === 'active');
  const all = active.length > 0 && active.every((p) => selected.has(p.id));
  const disabled = !canEdit || save.isPending || !selection.data;

  const put = (propertyIds: string[]) =>
    save.mutate({ botId, propertyIds }, { onError: () => toast.error(t('lodging.bot.error')) });
  const toggle = (propertyId: string, on: boolean) => {
    const next = places
      .filter((p) => (p.id === propertyId ? on : selected.has(p.id)))
      .map((p) => p.id);
    put(next);
  };

  if (properties.isPending || selection.isPending)
    return (
      <div className="grid gap-2" role="status" aria-label={t('lodging.loading')}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  if (properties.isError || selection.isError)
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {t('lodging.loadError')}
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void properties.refetch();
              void selection.refetch();
            }}
          >
            {t('lodging.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (places.length === 0)
    return (
      <div className="grid justify-items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
        <House className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">{t('lodging.bot.empty')}</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/app/properties">{t('lodging.bot.openProperties')}</Link>
        </Button>
      </div>
    );

  return (
    <div className="grid gap-3">
      {!canEdit && <p className="text-xs text-muted-foreground">{t('lodging.bot.readOnly')}</p>}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <Switch
          id={`${id}-all`}
          checked={all}
          disabled={disabled || all}
          onCheckedChange={(on) => on && put([])}
        />
        <div className="grid gap-0.5">
          <Label htmlFor={`${id}-all`}>{t('lodging.bot.all')}</Label>
          <p className="text-xs text-muted-foreground">{t('lodging.bot.allHint')}</p>
        </div>
      </div>
      <ul className="divide-y rounded-lg border">
        {places.map((p) => {
          const on = selected.has(p.id);
          const last = on && selected.size === 1;
          const switchId = `${id}-${p.id}`;
          return (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <Switch
                id={switchId}
                aria-label={t('lodging.bot.sells', { name: `${p.code} · ${p.name}` })}
                checked={on}
                disabled={disabled || last}
                aria-describedby={last ? `${id}-last` : undefined}
                onCheckedChange={(next) => toggle(p.id, next)}
              />
              <Label htmlFor={switchId} className="min-w-0 flex-1 font-normal">
                <span className="font-semibold tabular-nums">{p.code}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="truncate">{p.name}</span>
              </Label>
              <Badge variant="secondary" className="shrink-0">
                {t(`lodging.sellMode.${p.sellMode}`)}
              </Badge>
              {p.status === 'paused' && (
                <Badge variant="outline" className="shrink-0">
                  {t('lodging.places.paused')}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      {selected.size === 1 && (
        <p id={`${id}-last`} className="text-xs text-muted-foreground">
          {t('lodging.bot.lastOne')}
        </p>
      )}
    </div>
  );
}
