import type { PropertyDto, RateDto } from '@agent-sales/contracts';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

import { useDeleteOverride } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { formatVnd } from '../lib/format';
import { OverrideDialog } from './override-dialog';

const ddmmyyyy = (night: string) =>
  `${night.slice(8, 10)}/${night.slice(5, 7)}/${night.slice(0, 4)}`;

/** "Ngày đặc biệt": date-range prices, saved one by one (not part of the weekday draft). */
export function OverridesSection({
  property: p,
  canEdit,
  target,
}: {
  property: PropertyDto;
  canEdit: boolean;
  /** Only this target's special dates (a unit page); undefined = all. */
  target?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<RateDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<RateDto | null>(null);
  const remove = useDeleteOverride();
  const saveError = useSaveError();
  const overrides = p.rates
    .filter((r) => r.kind === 'override' && (target === undefined || r.unitId === target))
    .sort((a, b) => (a.dateFrom ?? '').localeCompare(b.dateFrom ?? ''));
  const unitName = (id: string | null) =>
    id === null ? t('lodging.rates.whole') : (p.units.find((u) => u.id === id)?.name ?? '');
  const targetName = (r: RateDto) => {
    const pkg = r.packageId ? p.packages.find((k) => k.id === r.packageId)?.name : undefined;
    return [target === undefined ? unitName(r.unitId) : '', pkg ?? ''].filter(Boolean).join(' · ');
  };

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t('lodging.overrides.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('lodging.overrides.hint')}</p>
        </div>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
            <Plus aria-hidden />
            {t('lodging.overrides.add')}
          </Button>
        )}
      </div>
      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('lodging.overrides.empty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {overrides.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="min-w-28 font-medium">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {t('lodging.overrides.nights', {
                  from: ddmmyyyy(r.dateFrom ?? ''),
                  to: ddmmyyyy(r.dateTo ?? ''),
                })}
              </span>
              <span className="text-muted-foreground">{targetName(r)}</span>
              <span className="tabular-nums">
                {formatVnd(r.sell)}
                <span className="text-xs text-muted-foreground"> / {formatVnd(r.cost)}</span>
              </span>
              {r.minNights && (
                <span className="text-xs text-muted-foreground">
                  {t('lodging.overrides.minNightsShort', { count: r.minNights })}
                </span>
              )}
              {canEdit && (
                <span className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('lodging.overrides.edit', { label: r.label })}
                    onClick={() => setEditing(r)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('lodging.overrides.delete', { label: r.label })}
                    onClick={() => setDeleting(r)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== undefined && (
        <OverrideDialog
          property={p}
          rate={editing}
          lockedTarget={target}
          onClose={() => setEditing(undefined)}
        />
      )}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('lodging.overrides.deleteTitle', { label: deleting?.label ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('lodging.overrides.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lodging.overrides.keep')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(
                  { id: p.id, rateId: deleting.id, version: p.version },
                  {
                    onSuccess: () => toast.success(t('lodging.overrides.deleted')),
                    onError: (error) => saveError(error),
                  },
                );
                setDeleting(null);
              }}
            >
              {t('lodging.overrides.delete', { label: deleting?.label ?? '' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
