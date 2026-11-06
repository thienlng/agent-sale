import type { BookingSource } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';

import { useBookings } from '../api/bookings';
import { dayMonth, formatVnd } from '../lib/format';
import { BookingSheet } from './booking-sheet';
import { BookingStatusBadge } from './booking-status-badge';

type SheetState = { key: number } & ({ mode: 'create' } | { mode: 'view'; bookingId: string });

/**
 * Inbox panel part for a hotel business: the bookings made from this conversation and
 * "Tạo booking", which opens the shared booking sheet with the guest prefilled and no
 * dates (the dates come first in the form).
 */
export function ConversationBookings({
  conversationId,
  contactId,
  guestName,
  guestPhone,
  source,
}: {
  conversationId: string;
  contactId: string | null;
  guestName: string;
  guestPhone: string;
  source?: BookingSource | undefined;
}) {
  const { t } = useTranslation('lodging');
  const canCreate = useCan('orders.manage');
  const bookings = useBookings({ view: 'all', conversationId });
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const list = bookings.data?.data ?? [];

  return (
    <div className="grid gap-2">
      {bookings.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : bookings.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
          {t('conv.loadError')}
          <Button size="xs" variant="outline" onClick={() => void bookings.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('conv.empty')}</p>
      ) : (
        <ul className="grid gap-1.5">
          {list.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => setSheet({ key: Date.now(), mode: 'view', bookingId: b.id })}
                className="grid w-full gap-1 rounded-lg border p-2 text-left text-sm hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">{b.code}</span>
                  <BookingStatusBadge status={b.status} />
                </span>
                <span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                  <span>
                    {b.propertyCode} · {dayMonth(b.checkIn)} → {dayMonth(b.checkOut)}
                  </span>
                  {b.totalSell !== null && <span>{formatVnd(b.totalSell)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {canCreate && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => setSheet({ key: Date.now(), mode: 'create' })}
          >
            <Plus aria-hidden />
            {t('conv.create')}
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link to="/app/bookings">{t('conv.all')}</Link>
        </Button>
      </div>
      {sheet?.mode === 'create' && (
        <BookingSheet
          key={sheet.key}
          mode="create"
          open
          initial={{
            guestName,
            guestPhone,
            contactId,
            conversationId,
            ...(source ? { source } : {}),
          }}
          onOpenChange={(o) => !o && setSheet(null)}
        />
      )}
      {sheet?.mode === 'view' && (
        <BookingSheet
          key={sheet.key}
          mode="view"
          open
          bookingId={sheet.bookingId}
          onOpenChange={(o) => !o && setSheet(null)}
        />
      )}
    </div>
  );
}
