import type { BookingAction, BookingDetail } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Bot, MessageCircle, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import { useBooking, useChangeBookingStatus } from '../api/bookings';
import {
  clockTime,
  dayMonth,
  localDayMonth,
  nightsBetween,
  todayNight,
  weekdayShort,
} from '../lib/format';
import { botHoldPending } from '../lib/bot-hold';
import { BookingEditForm } from './booking-edit-form';
import { BookingErrorAlert } from './booking-error-alert';
import { BookingNightNotes, type NoteFocus } from './booking-night-notes';
import { SheetSection } from './booking-fields';
import { BookingStatusBadge } from './booking-status-badge';
import { QuoteSummary } from './quote-breakdown';
import { TagChips } from './tag-input';

/** Primary action first; "cancel" is drawn apart in red. */
const ACTIONS: Partial<Record<BookingDetail['status'], BookingAction[]>> = {
  hold: ['confirm', 'extend_hold', 'cancel'],
  confirmed: ['check_in', 'no_show', 'cancel'],
  checked_in: ['check_out'],
  active: ['remove_block'],
};
const EDITABLE = new Set(['hold', 'confirmed', 'checked_in', 'active']);

/**
 * View mode of the booking sheet: status actions, details, price, night notes, history and
 * editing. `focusNote` opens the night-note editor on that night and unit (calendar tooltip).
 */
export function BookingView({
  bookingId,
  focusNote,
}: {
  bookingId: string;
  focusNote?: NoteFocus | undefined;
}) {
  const { t } = useTranslation('lodging');
  const booking = useBooking(bookingId);
  const change = useChangeBookingStatus();
  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  // View-only members read the booking; status moves and edits need orders.manage.
  const canManage = useCan('orders.manage');

  if (booking.isPending)
    return (
      <div className="grid gap-3 px-4" role="status" aria-label={t('loading')}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (booking.isError || !booking.data)
    return (
      <div className="px-4">
        <Alert variant="destructive">
          <AlertDescription className="flex items-center gap-2">
            {t('sheet.loadError')}
            <Button size="xs" variant="outline" onClick={() => void booking.refetch()}>
              {t('sheet.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );

  const b = booking.data;
  const run = (action: BookingAction, why = '') =>
    change.mutate(
      { id: b.id, body: { version: b.version, action, reason: why } },
      {
        onSuccess: (next) => {
          toast.success(t('sheet.statusChanged', { code: next.code }), { duration: 3500 });
          setCancelOpen(false);
          setReason('');
        },
      },
    );
  // A stale or failed action is cleared once the fresh booking is loaded.
  const reload = () => {
    change.reset();
    void booking.refetch();
  };
  const actions = canManage ? (ACTIONS[b.status] ?? []) : [];
  const byBot = b.kind === 'stay' && b.source === 'bot';
  const tooEarly = b.checkIn > todayNight();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 pb-3">
          {actions
            .filter((a) => a !== 'cancel')
            .map((a, i) =>
              a === 'check_in' && tooEarly ? (
                <Tooltip key={a}>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button size="sm" disabled>
                        {t(`sheet.action.${a}`)}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('sheet.checkInTooEarly', { date: dayMonth(b.checkIn) })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  key={a}
                  size="sm"
                  variant={i === 0 ? 'default' : 'outline'}
                  disabled={change.isPending}
                  onClick={() => run(a)}
                >
                  {t(`sheet.action.${a}`)}
                </Button>
              ),
            )}
          {EDITABLE.has(b.status) && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              {t('sheet.edit')}
            </Button>
          )}
          {actions.includes('cancel') && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              disabled={change.isPending}
              onClick={() => {
                // A previous failure (e.g. a stale confirm) must not show up in the new dialog.
                change.reset();
                setCancelOpen(true);
              }}
            >
              {t('sheet.action.cancel')}
            </Button>
          )}
        </div>
      )}
      {change.error && !cancelOpen && (
        <div className="px-4 pt-3">
          <BookingErrorAlert error={change.error} onReload={reload} />
        </div>
      )}

      {editing && canManage ? (
        <BookingEditForm
          key={b.version}
          booking={b}
          onDone={() => setEditing(false)}
          onReload={reload}
        />
      ) : (
        <div className="grid flex-1 content-start gap-5 overflow-y-auto px-4 py-4 text-sm">
          {byBot && <BotBookingBanner booking={b} />}
          <SheetSection title={t('sheet.sectionDates')}>
            <p className="tabular-nums">
              {weekdayShort(t, b.checkIn)} {dayMonth(b.checkIn)} → {weekdayShort(t, b.checkOut)}{' '}
              {dayMonth(b.checkOut)}{' '}
              <span className="text-muted-foreground">
                · {t('sheet.nights', { count: nightsBetween(b.checkIn, b.checkOut) })}
              </span>
            </p>
            <p>
              {[b.whole ? t('sheet.whole') : b.unitNames.join(', '), ...b.packageNames].join(' · ')}
            </p>
            {b.status === 'hold' && b.holdExpiresAt && (
              <p className="text-warning">
                {t('sheet.holdUntil', {
                  time: `${clockTime(b.holdExpiresAt)} ${localDayMonth(b.holdExpiresAt)}`,
                })}
              </p>
            )}
            {b.kind === 'block' && b.blockReason && (
              <p className="text-muted-foreground">{b.blockReason}</p>
            )}
          </SheetSection>
          {b.kind === 'stay' && (
            <SheetSection title={t('sheet.sectionGuest')}>
              <p className="font-medium">{b.guestName}</p>
              <p className="tabular-nums text-muted-foreground">
                {b.guestPhone || t('sheet.noGuestPhone')}
              </p>
              <p className="tabular-nums">
                {t('sheet.guests', {
                  adults: b.party.adults,
                  children: b.party.childAges.length,
                })}
                {b.party.childAges.length > 0 &&
                  ` (${t('sheet.childAgesList', { ages: b.party.childAges.join(', ') })})`}
                {b.source && (
                  <span className="text-muted-foreground"> · {t(`source.${b.source}`)}</span>
                )}
              </p>
              {b.conversationId && !byBot && (
                <ConversationButton conversationId={b.conversationId} />
              )}
            </SheetSection>
          )}
          {b.kind === 'stay' && (
            <SheetSection title={t('sheet.sectionPrice')}>
              <QuoteSummary
                quote={b.quote}
                adjustment={b.adjustment}
                adjustmentReason={b.adjustmentReason}
                totalSell={b.totalSell}
              />
            </SheetSection>
          )}
          {(b.note || b.tags.length > 0) && (
            <SheetSection title={t('sheet.sectionNote')}>
              <TagChips tags={b.tags} />
              {b.note && <p className="whitespace-pre-wrap">{b.note}</p>}
            </SheetSection>
          )}
          <BookingNightNotes booking={b} focus={focusNote} />
          <SheetSection title={t('sheet.sectionHistory')}>
            {b.history.length === 0 ? (
              <p className="text-muted-foreground">{t('history.empty')}</p>
            ) : (
              <ol className="grid gap-1.5">
                {b.history.map((h, i) => {
                  const key = h.action.split('.').pop() ?? h.action;
                  const why = typeof h.data['reason'] === 'string' ? h.data['reason'] : '';
                  return (
                    <li key={i} className="flex flex-wrap gap-x-2 text-[13px]">
                      <span className="tabular-nums text-muted-foreground">
                        {formatDateTime(h.at)}
                      </span>
                      <span className="font-medium">
                        {t(`history.action.${key}`, { defaultValue: key })}
                      </span>
                      <span className="text-muted-foreground">
                        {h.actorName ?? t('history.system')}
                      </span>
                      {why && <span className="w-full text-muted-foreground">{why}</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </SheetSection>
        </div>
      )}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sheet.cancelTitle', { code: b.code })}</AlertDialogTitle>
            <AlertDialogDescription>{t('sheet.cancelDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            aria-label={t('sheet.cancelReason')}
            placeholder={t('sheet.cancelReason')}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {change.error && <BookingErrorAlert error={change.error} onReload={reload} />}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sheet.keep')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!reason.trim() || change.isPending}
              onClick={(e) => {
                e.preventDefault();
                run('cancel', reason.trim());
              }}
            >
              {t('sheet.action.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConversationButton({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('lodging');
  return (
    <Button asChild size="sm" variant="outline" className="w-fit bg-background">
      <Link to="/app/inbox" search={{ conversation: conversationId }}>
        <MessageCircle aria-hidden />
        {t('sheet.conversation')}
      </Link>
    </Button>
  );
}

/**
 * Top of a bot booking (T-161): while the hold waits for staff, what to do next (call the guest,
 * then press Xác nhận); afterwards a quiet "made by the bot" line. "Mở hội thoại" sits here so
 * staff read what the guest asked before calling.
 */
function BotBookingBanner({ booking: b }: { booking: BookingDetail }) {
  const { t } = useTranslation('lodging');
  const pending = botHoldPending(b);
  return (
    <section
      aria-label={t('sheet.botLabel')}
      className={
        pending
          ? 'flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5'
          : 'flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground'
      }
    >
      <p className="flex min-w-0 flex-1 basis-56 items-start gap-2">
        <Bot
          className={pending ? 'mt-0.5 size-4 shrink-0 text-warning' : 'mt-0.5 size-4 shrink-0'}
          aria-hidden
        />
        <span className={pending ? 'font-medium text-foreground' : undefined}>
          {pending ? t('sheet.botHoldHint') : t('sheet.botCreated')}
        </span>
      </p>
      {b.conversationId && <ConversationButton conversationId={b.conversationId} />}
    </section>
  );
}

/** Header line of the view: code, status badge and property. */
export function BookingViewTitle({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation('lodging');
  const booking = useBooking(bookingId);
  const b = booking.data;
  if (!b) return <span>{t('sheet.viewDescription')}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="tabular-nums">{b.code}</span>
      <BookingStatusBadge status={b.status} />
      <span className="text-sm font-normal text-muted-foreground">
        {b.propertyCode} · {b.propertyName}
      </span>
    </span>
  );
}
