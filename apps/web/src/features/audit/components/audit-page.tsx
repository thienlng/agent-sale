import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';

import { useAuditEvents } from '../api/audit';

const ALL = '__all';
/** Prefixes shown in the filter (an action ending in "." matches the whole area). */
const AREAS = ['member.', 'workspace.', 'security.', 'billing.'] as const;

/** One line of detail for the events whose changes are worth showing inline. */
function detail(data: Record<string, unknown>, t: (k: string) => string): string | null {
  const role = data['role'];
  if (role && typeof role === 'object' && 'from' in role && 'to' in role) {
    const r = role as { from: string; to: string };
    return `${t(`team.roles.${r.from}`)} → ${t(`team.roles.${r.to}`)}`;
  }
  if (typeof role === 'string') return t(`team.roles.${role}`);
  const changes = data['changes'];
  if (changes && typeof changes === 'object') return Object.keys(changes).join(', ');
  return null;
}

/** Who changed what in the workspace (owners and admins). */
export function AuditPage() {
  const { t } = useTranslation();
  const [area, setArea] = useState<string>(ALL);
  const events = useAuditEvents(area === ALL ? undefined : area);
  const rows = events.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('team.audit.title')}</h2>
        <Select value={area} onValueChange={setArea}>
          <SelectTrigger className="h-9 w-44" aria-label={t('team.audit.all')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('team.audit.all')}</SelectItem>
            {AREAS.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`team.audit.areas.${a.replace('.', '')}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {events.isPending ? (
        <Skeleton className="h-40" />
      ) : rows.length ? (
        <ol className="divide-y rounded-xl border">
          {rows.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t(`team.audit.actions.${e.action}`, { defaultValue: e.action })}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    t('team.audit.actor') + ': ' + (e.actorName ?? t('team.audit.system')),
                    detail(e.data, t),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <time dateTime={e.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDateTime(e.at)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t('team.audit.empty')}
        </p>
      )}
      {events.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            disabled={events.isFetchingNextPage}
            onClick={() => void events.fetchNextPage()}
          >
            {t('team.audit.more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
