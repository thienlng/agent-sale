import type { PropertyDto } from '@agent-sales/contracts';
import { Check, CircleAlert, Copy, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

import { useDeleteProperty, useUpdateProperty } from '../api/properties';

interface Bookings {
  total: number;
  upcoming: number;
}

/** The counts of a 409 `property_has_bookings`, or null for any other error. */
function bookingsOf(e: unknown): Bookings | null {
  if (!(e instanceof ApiClientError) || e.details?.['reason'] !== 'property_has_bookings') {
    return null;
  }
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { total: Math.max(1, n(e.details['bookings'])), upcoming: n(e.details['upcoming']) };
}

/**
 * "Xoá căn hộ" danger zone of the property editor. A property without bookings is deleted after a
 * plain confirm. For one with bookings the server answers with the counts; the dialog then says
 * the bookings go too, asks for the property code typed (or copied) and offers pausing instead.
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
  const [bookings, setBookings] = useState<Bookings | null>(null);
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const label = `${p.code} · ${p.name}`;
  const codeMatches = typed.trim() === p.code.trim();

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setBookings(null);
      setTyped('');
      setCopied(false);
    }
  }

  function confirm() {
    remove.mutate(
      { id: p.id, withBookings: bookings !== null },
      {
        onSuccess: () => {
          toast.success(t('delete.deleted', { name: label }));
          close(false);
          onDeleted();
        },
        onError: (err) => {
          const found = bookingsOf(err);
          if (found) setBookings(found);
          else toast.error(errorMessage(tc, err));
        },
      },
    );
  }

  function copyCode() {
    void navigator.clipboard
      .writeText(p.code)
      .then(() => {
        setCopied(true);
        toast.success(t('delete.codeCopied'));
      })
      .catch(() => undefined);
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
          {bookings ? (
            <>
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription className="flex flex-col gap-1">
                  <p>{t('delete.hasBookings', { count: bookings.total })}</p>
                  {bookings.upcoming > 0 ? (
                    <p className="font-medium">
                      {t('delete.upcoming', { count: bookings.upcoming })}
                    </p>
                  ) : null}
                  {p.status === 'active' ? <p>{t('delete.keepHistory')}</p> : null}
                </AlertDescription>
              </Alert>
              <div className="flex flex-col gap-2">
                <Label htmlFor={inputId}>{t('delete.confirmCodeLabel')}</Label>
                <Input
                  id={inputId}
                  value={typed}
                  autoComplete="off"
                  aria-describedby={hintId}
                  onChange={(e) => setTyped(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span id={hintId}>
                    {t('delete.confirmCodeHint')}{' '}
                    <span className="font-medium text-foreground select-all">{p.code}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('delete.copyCode', { code: p.code })}
                    title={t('delete.copyCode', { code: p.code })}
                    onClick={copyCode}
                  >
                    {copied ? <Check className="text-success" /> : <Copy />}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('delete.cancel')}</AlertDialogCancel>
            {bookings && p.status === 'active' ? (
              <Button
                type="button"
                variant="outline"
                disabled={pause.isPending || remove.isPending}
                onClick={pauseInstead}
              >
                {t('delete.pauseInstead')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending || (bookings !== null && !codeMatches)}
              onClick={confirm}
            >
              {remove.isPending
                ? t('delete.deleting')
                : bookings
                  ? t('delete.confirmWithBookings', { count: bookings.total })
                  : t('delete.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
