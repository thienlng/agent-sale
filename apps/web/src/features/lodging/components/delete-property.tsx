import type { PropertyDto } from '@agent-sales/contracts';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

import { useDeleteProperty, useUpdateProperty } from '../api/properties';

const hasBookings = (e: unknown) =>
  e instanceof ApiClientError && e.details?.['reason'] === 'property_has_bookings';

/**
 * "Xoá căn hộ" danger zone of the property editor. Only a property that has never had a booking
 * can be deleted; for one with bookings the dialog says so and offers to pause it instead.
 */
export function DeletePropertySection({
  property: p,
  onDeleted,
}: {
  property: PropertyDto;
  /** Called after the delete (the editor goes back to the list). */
  onDeleted: () => void;
}) {
  const { t } = useTranslation('lodging');
  const { t: tc } = useTranslation();
  const remove = useDeleteProperty();
  const pause = useUpdateProperty();
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const label = `${p.code} · ${p.name}`;

  function close(next: boolean) {
    setOpen(next);
    if (!next) setBlocked(false);
  }

  function confirm() {
    remove.mutate(p.id, {
      onSuccess: () => {
        toast.success(t('delete.deleted', { name: label }));
        close(false);
        onDeleted();
      },
      onError: (err) => {
        if (hasBookings(err)) setBlocked(true);
        else toast.error(errorMessage(tc, err));
      },
    });
  }

  function pauseInstead() {
    pause.mutate(
      { id: p.id, body: { version: p.version, patch: { status: 'paused' } } },
      {
        onSuccess: () => {
          toast.success(t('delete.paused', { name: label }));
          close(false);
        },
        onError: (err) => toast.error(errorMessage(tc, err)),
      },
    );
  }

  return (
    <section
      aria-labelledby="delete-property-title"
      className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 p-4"
    >
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="delete-property-title" className="font-medium">
          {t('delete.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('delete.hint')}</p>
      </div>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        {t('delete.action')}
      </Button>
      <AlertDialog open={open} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.confirmTitle', { name: label })}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          {blocked ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                {p.status === 'paused' ? t('delete.hasBookingsPaused') : t('delete.hasBookings')}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('delete.cancel')}</AlertDialogCancel>
            {blocked ? (
              p.status === 'active' ? (
                <Button type="button" disabled={pause.isPending} onClick={pauseInstead}>
                  {t('delete.pauseInstead')}
                </Button>
              ) : null
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                onClick={confirm}
              >
                {remove.isPending ? t('delete.deleting') : t('delete.confirm')}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
