import type { AdminPlanDto } from '@agent-sales/contracts';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber, formatVnd } from '@/lib/format';

import { useAdminPlans, useArchivePlan } from '../../api/backoffice';
import { toastAdminError } from '../../lib/mutation-error';
import { PageHeader } from './page-header';
import { PlanDialog } from './plan-dialog';
import { ReasonDialog } from './reason-dialog';

function Limit({ value }: { value: unknown }) {
  const { t } = useTranslation('backoffice');
  if (value === null) return <>∞</>;
  if (typeof value === 'number') return <>{formatNumber(value)}</>;
  if (value && typeof value === 'object' && 'amount' in value)
    return <>{formatNumber(Number((value as { amount: number }).amount))}</>;
  return <>{t('common.none')}</>;
}

/** The plan catalog (ADR-021 §6): latest versions, plus older versions that still have subscribers. */
export function PlansPage() {
  const { t } = useTranslation('backoffice');
  const plans = useAdminPlans();
  const archive = useArchivePlan();
  const [editing, setEditing] = useState<AdminPlanDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<AdminPlanDto | null>(null);

  // Only the newest version of a code can be edited or archived.
  const latest = new Map<string, number>();
  for (const p of plans.data ?? [])
    latest.set(p.code, Math.max(latest.get(p.code) ?? 0, p.version));
  const rows = [...(plans.data ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code) || b.version - a.version,
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={t('plans.title')}
        subtitle={t('plans.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> {t('plans.add')}
          </Button>
        }
      />

      {plans.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : plans.isError ? (
        <div className="flex items-center gap-3 text-sm text-destructive">
          {t('common.loadError')}
          <Button size="sm" variant="outline" onClick={() => void plans.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('plans.name')}</TableHead>
                <TableHead>{t('plans.version')}</TableHead>
                {(['1', '3', '6', '12'] as const).map((p) => (
                  <TableHead key={p} className="text-right">
                    {t('common.months', { count: Number(p) })}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t('entitlements.members.max')}</TableHead>
                <TableHead className="text-right">{t('entitlements.channels.max')}</TableHead>
                <TableHead className="text-right">{t('entitlements.contacts.max')}</TableHead>
                <TableHead className="text-right">
                  {t('entitlements.ai.included_messages')}
                </TableHead>
                <TableHead className="text-right">{t('plans.subscribers')}</TableHead>
                <TableHead />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const isLatest = latest.get(p.code) === p.version;
                return (
                  <TableRow key={`${p.code}@${p.version}`} className={isLatest ? '' : 'opacity-60'}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                    </TableCell>
                    <TableCell>
                      v{p.version}
                      {isLatest ? null : (
                        <div className="text-xs text-muted-foreground">{t('plans.oldVersion')}</div>
                      )}
                    </TableCell>
                    {(['1', '3', '6', '12'] as const).map((k) => (
                      <TableCell key={k} className="text-right tabular-nums">
                        {p.priceByPeriod[k] ? formatVnd(p.priceByPeriod[k]) : t('common.none')}
                      </TableCell>
                    ))}
                    {(
                      [
                        'members.max',
                        'channels.max',
                        'contacts.max',
                        'ai.included_messages',
                      ] as const
                    ).map((k) => (
                      <TableCell key={k} className="text-right tabular-nums">
                        <Limit value={p.entitlements[k]} />
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(p.subscriberCount)}
                    </TableCell>
                    <TableCell>
                      {p.archived ? (
                        <Badge variant="outline">{t('plans.archived')}</Badge>
                      ) : p.isPublic ? (
                        <Badge variant="secondary">{t('plans.public')}</Badge>
                      ) : (
                        <Badge variant="outline">{t('plans.hidden')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {isLatest ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                            {t('plans.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setArchiving(p)}>
                            {p.archived ? t('plans.unarchive') : t('plans.archive')}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PlanDialog
        open={creating || editing !== null}
        plan={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
      <ReasonDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={
          archiving
            ? t(archiving.archived ? 'plans.unarchiveTitle' : 'plans.archiveTitle', {
                name: archiving.name,
              })
            : ''
        }
        description={archiving && !archiving.archived ? t('plans.archiveHint') : undefined}
        confirmLabel={archiving?.archived ? t('plans.unarchive') : t('plans.archive')}
        destructive={!archiving?.archived}
        pending={archive.isPending}
        onConfirm={(reason) =>
          archiving &&
          archive.mutate(
            { code: archiving.code, body: { archived: !archiving.archived, reason } },
            {
              onSuccess: () => {
                toast.success(t('common.saved'));
                setArchiving(null);
              },
              onError: (err) => toastAdminError(t, err),
            },
          )
        }
      />
    </div>
  );
}
