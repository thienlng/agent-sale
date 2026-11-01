import type { BookingDetail, UpdateBookingRequest } from '@agent-sales/contracts';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useUpdateBooking } from '../api/bookings';
import { useProperty } from '../api/properties';
import { useQuote } from '../api/calendar';
import { quoteBody } from '../hooks/use-booking-draft';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { isStayRange } from '../lib/format';
import { type PartyValue, type PriceFields, toParty } from '../lib/party';
import { BookingErrorAlert } from './booking-error-alert';
import { SavingLabel, SheetSection, StayDates, TakenAlert, UnitPicker } from './booking-fields';
import { PartyInput } from './party-input';
import { QuoteBreakdown } from './quote-breakdown';

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** The room total typed by staff when the booking was saved, or null when it used the quote. */
export function storedManualTotal(b: BookingDetail): number | null {
  if (b.totalSell === null) return null;
  const base = b.totalSell - b.adjustment;
  return b.quote && b.quote.totalSell === base ? null : base;
}

/**
 * Edit mode of the booking sheet. Hold/confirmed stays edit dates, rooms, guests, price and
 * note; active blocks edit dates, rooms and note; checked-in stays only the check-out date.
 * A manual price never silently survives a change of dates/rooms/guests: staff must type a
 * new one or explicitly choose the calculated price.
 */
export function BookingEditForm({
  booking,
  onDone,
  onReload,
}: {
  booking: BookingDetail;
  onDone: () => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const update = useUpdateBooking();
  const property = useProperty(booking.propertyId);
  const block = booking.kind === 'block';
  const checkedIn = booking.status === 'checked_in';
  const stay = !block && !checkedIn;
  const originalManual = storedManualTotal(booking);

  const [checkIn, setCheckIn] = useState(booking.checkIn);
  const [checkOut, setCheckOut] = useState(booking.checkOut);
  const [whole, setWhole] = useState(booking.whole);
  const [unitIds, setUnitIds] = useState(booking.unitIds);
  const [party, setParty] = useState<PartyValue>(booking.party);
  const [guestName, setGuestName] = useState(booking.guestName);
  const [guestPhone, setGuestPhone] = useState(booking.guestPhone);
  const [note, setNote] = useState(booking.note);
  const [price, setPrice] = useState<PriceFields>({
    adjustment: booking.adjustment,
    adjustmentReason: booking.adjustmentReason,
    manualTotal: originalManual,
  });
  const [manualTouched, setManualTouched] = useState(false);
  const [useAuto, setUseAuto] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const stayChanged =
    checkIn !== booking.checkIn ||
    checkOut !== booking.checkOut ||
    whole !== booking.whole ||
    (!whole && !sameList(unitIds, booking.unitIds)) ||
    party.adults !== booking.party.adults ||
    !sameList(party.childAges, booking.party.childAges);
  // Checked-in stays only move check-out and never send price fields, so no manual-price choice.
  const manualRequired = stay && originalManual !== null && stayChanged;
  const manualMissing =
    manualRequired && !useAuto && (!manualTouched || price.manualTotal === null);

  const body = useMemo(
    () =>
      block
        ? null
        : quoteBody({ propertyId: booking.propertyId, checkIn, checkOut, whole, unitIds, party }),
    [block, booking.propertyId, checkIn, checkOut, whole, unitIds, party],
  );
  const quote = useQuote(useDebouncedValue(stayChanged ? body : null, 300));

  const invalid =
    !isStayRange(checkIn, checkOut) ||
    (!whole && unitIds.length === 0) ||
    (stay && (!guestName.trim() || !toParty(party))) ||
    manualMissing;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || update.isPending) return;
    const out: UpdateBookingRequest = { version: booking.version };
    if (checkOut !== booking.checkOut) out.checkOut = checkOut;
    if (!checkedIn) {
      if (checkIn !== booking.checkIn) out.checkIn = checkIn;
      if (whole !== booking.whole || !sameList(unitIds, booking.unitIds)) {
        out.whole = whole;
        out.unitIds = whole ? [] : unitIds;
      }
      if (note !== booking.note) out.note = note;
    }
    if (stay) {
      const p = toParty(party);
      if (p && stayChanged) out.party = p;
      if (guestName.trim() !== booking.guestName) out.guestName = guestName.trim();
      if (guestPhone.trim() !== booking.guestPhone) out.guestPhone = guestPhone.trim();
      if (price.adjustment !== booking.adjustment) out.adjustment = price.adjustment;
      if (price.adjustmentReason !== booking.adjustmentReason)
        out.adjustmentReason = price.adjustmentReason;
      if (manualRequired) out.manualTotalSell = useAuto ? null : price.manualTotal;
      else if (price.manualTotal !== originalManual) out.manualTotalSell = price.manualTotal;
    }
    update.mutate(
      { id: booking.id, body: out },
      {
        onSuccess: (b) => {
          toast.success(t('lodging.sheet.saved', { code: b.code }), { duration: 3500 });
          onDone();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="grid flex-1 gap-5 overflow-y-auto px-4 pb-4">
        <SheetSection title={t('lodging.sheet.sectionDates')}>
          <StayDates
            checkIn={checkIn}
            checkOut={checkOut}
            disableCheckIn={checkedIn}
            onChange={(r) => {
              setCheckIn(r.checkIn);
              setCheckOut(r.checkOut);
            }}
            showError={submitted}
          />
          {!checkedIn && (
            <UnitPicker
              property={property.data}
              whole={whole}
              unitIds={unitIds}
              onChange={(n) => {
                setWhole(n.whole);
                setUnitIds(n.unitIds);
              }}
              showError={submitted}
            />
          )}
          <TakenAlert quote={quote.data} />
        </SheetSection>
        {stay && (
          <SheetSection title={t('lodging.sheet.sectionGuest')}>
            <PartyInput value={party} onChange={setParty} />
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-name`} className="text-xs">
                  {t('lodging.sheet.guestName')}
                </Label>
                <Input
                  id={`${id}-name`}
                  className="h-8"
                  value={guestName}
                  aria-invalid={(submitted && !guestName.trim()) || undefined}
                  onChange={(e) => setGuestName(e.target.value)}
                />
                {submitted && !guestName.trim() && (
                  <p className="text-xs text-destructive">{t('lodging.sheet.required')}</p>
                )}
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-phone`} className="text-xs">
                  {t('lodging.sheet.guestPhone')}
                </Label>
                <Input
                  id={`${id}-phone`}
                  type="tel"
                  className="h-8 tabular-nums"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                />
              </div>
            </div>
          </SheetSection>
        )}
        {stay && (
          <SheetSection title={t('lodging.sheet.sectionPrice')}>
            <QuoteBreakdown
              quote={stayChanged ? quote.data : (booking.quote ?? undefined)}
              loading={quote.isFetching}
              failed={quote.isError}
              checkIn={checkIn}
              checkOut={checkOut}
              standard={
                property.data
                  ? {
                      adults: property.data.standardAdults,
                      children: property.data.standardChildren,
                    }
                  : null
              }
              price={price}
              onPriceChange={(next) => {
                if (next.manualTotal !== price.manualTotal) setManualTouched(true);
                setPrice(next);
              }}
              manualRequired={manualRequired}
              useAuto={useAuto}
              onUseAutoChange={setUseAuto}
            />
          </SheetSection>
        )}
        {!checkedIn && (
          <SheetSection title={t('lodging.sheet.sectionNote')}>
            <Textarea
              aria-label={t('lodging.sheet.note')}
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </SheetSection>
        )}
        <BookingErrorAlert error={update.error} onReload={onReload} />
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('lodging.sheet.cancelEdit')}
        </Button>
        <Button type="submit" disabled={update.isPending || (submitted && invalid)}>
          <SavingLabel saving={update.isPending}>{t('lodging.sheet.save')}</SavingLabel>
        </Button>
      </div>
    </form>
  );
}
