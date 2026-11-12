import { BUSINESS_RESTORE_DAYS, type DeletedBusinessDto } from '@agent-sales/contracts';
import { Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { BusinessAvatar } from '@/components/business-avatar';
import { Button } from '@/components/ui/button';
import { formatDay, isoDate } from '@/lib/format';
import { reloadSession } from '@/lib/session';

import { useDeletedBusinesses, useRestoreBusiness } from '../api/business-deletion';
import { restoreDaysLeft } from '../lib/business-gallery';

/**
 * "Đã xoá" on "Business của tôi" (ADR-033): the owner's deleted businesses with the days left to
 * restore them. Hidden when there are none (or the list cannot be read: it is a convenience).
 */
export function DeletedBusinesses() {
  const { t } = useTranslation();
  const deleted = useDeletedBusinesses();
  const restore = useRestoreBusiness();
  const list = deleted.data?.data ?? [];
  if (!list.length) return null;

  const onRestore = (b: DeletedBusinessDto) =>
    restore.mutate(b.workspaceId, {
      onSuccess: async () => {
        toast.success(t('business.gallery.deleted.restored', { name: b.name }));
        // Back in the memberships, so the gallery and the switcher show it again.
        await reloadSession().catch(() => undefined);
      },
      onError: () => toast.error(t('business.gallery.deleted.restoreError')),
    });

  return (
    <section aria-labelledby="deleted-businesses-title" className="flex flex-col gap-3">
      <div>
        <h2 id="deleted-businesses-title" className="font-semibold">
          {t('business.gallery.deleted.title', { days: BUSINESS_RESTORE_DAYS })}
        </h2>
        <p className="text-sm text-muted-foreground">{t('business.gallery.deleted.hint')}</p>
      </div>
      <ul className="divide-y rounded-xl border">
        {list.map((b) => {
          const left = restoreDaysLeft(b.purgeAfter);
          const pending = restore.isPending && restore.variables === b.workspaceId;
          return (
            <li key={b.workspaceId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <BusinessAvatar
                workspaceId={b.workspaceId}
                logoVersion={null}
                icon={b.icon}
                className="size-10 shrink-0 opacity-60"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate font-medium">{b.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('business.gallery.deleted.deletedOn', {
                    date: formatDay(isoDate(new Date(b.deletedAt))),
                  })}
                  {' · '}
                  <span className={left <= 3 ? 'text-destructive' : undefined}>
                    {left <= 1
                      ? t('business.gallery.deleted.lastDay')
                      : t('business.gallery.deleted.daysLeft', { count: left })}
                  </span>
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={restore.isPending}
                onClick={() => onRestore(b)}
                aria-label={t('business.gallery.deleted.restoreLabel', { name: b.name })}
              >
                {pending ? (
                  <Loader2 aria-hidden className="animate-spin" />
                ) : (
                  <RotateCcw aria-hidden />
                )}
                {t('business.gallery.deleted.restore')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
