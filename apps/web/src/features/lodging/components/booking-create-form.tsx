import type { BookingDetail, BookingSource } from '@agent-sales/contracts';
import { BookingSource as BookingSourceEnum } from '@agent-sales/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspaceId } from '@/lib/use-workspace';

import { lodgingConflict, useCreateBooking } from '../api/bookings';
import { lodgingKeys } from '../api/keys';
import { useProperties, useProperty } from '../api/properties';
import {
  type BookingCreateInitial,
  type CreateKind,
  createRequest,
  useBookingDraft,
  validateDraft,
} from '../hooks/use-booking-draft';
import { BookingErrorAlert } from './booking-error-alert';
import { SavingLabel, SheetSection, StayDates, TakenAlert, UnitPicker } from './booking-fields';
import { PartyInput } from './party-input';
import { QuoteBreakdown } from './quote-breakdown';

const SUBMIT_LABEL: Record<CreateKind, string> = {
  hold: 'lodging.sheet.submitHold',
  confirmed: 'lodging.sheet.submitConfirmed',
  block: 'lodging.sheet.submitBlock',
};

/** Create mode of the booking sheet: Giữ chỗ / Đặt luôn / Khoá lịch with a live quote. */
export function BookingCreateForm({
  initial,
  onCreated,
}: {
  initial: BookingCreateInitial | undefined;
  onCreated: (booking: BookingDetail) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { draft, patch, quote } = useBookingDraft(initial);
  const properties = useProperties();
  const property = useProperty(draft.propertyId || undefined);
  const create = useCreateBooking();
  // One id per attempt until it succeeds, so a retried submit cannot create two bookings.
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const errors = validateDraft(draft);
  const show = (field: keyof typeof errors) =>
    Boolean(errors[field]) && (submitted || touched.has(field));
  const blur = (field: string) => () => setTouched((s) => new Set(s).add(field));
  const block = draft.kind === 'block';
  const p = property.data;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0 || create.isPending) return;
    create.mutate(
      createRequest(draft, clientRequestId, {
        contactId: initial?.contactId ?? null,
        conversationId: initial?.conversationId ?? null,
      }),
      {
        onSuccess: (booking) => {
          setClientRequestId(crypto.randomUUID());
          toast.success(t('lodging.sheet.created', { code: booking.code }), { duration: 3500 });
          onCreated(booking);
        },
        onError: (error) => {
          // The nights went to someone else: show the fresh calendar and quote.
          if (lodgingConflict(error).reason === 'NIGHTS_TAKEN')
            void qc.invalidateQueries({ queryKey: lodgingKeys.all(ws) });
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="grid flex-1 gap-5 overflow-y-auto px-4 pb-4">
        <Tabs value={draft.kind} onValueChange={(v) => patch({ kind: v as CreateKind })}>
          <TabsList aria-label={t('lodging.sheet.kind')} className="w-full">
            <TabsTrigger value="hold">{t('lodging.sheet.tabHold')}</TabsTrigger>
            <TabsTrigger value="confirmed">{t('lodging.sheet.tabConfirmed')}</TabsTrigger>
            <TabsTrigger value="block">{t('lodging.sheet.tabBlock')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <SheetSection title={t('lodging.sheet.sectionDates')}>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-property`} className="text-xs">
              {t('lodging.sheet.property')}
            </Label>
            <Select
              value={draft.propertyId}
              onValueChange={(propertyId) => patch({ propertyId, whole: true, unitIds: [] })}
            >
              <SelectTrigger
                id={`${id}-property`}
                className="w-full"
                aria-invalid={show('property') || undefined}
              >
                <SelectValue placeholder={t('lodging.sheet.chooseProperty')}>
                  {p ? `${p.code} · ${p.name}` : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(properties.data ?? []).map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.code} · {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {show('property') && (
              <p className="text-xs text-destructive">{t('lodging.sheet.required')}</p>
            )}
          </div>
          <StayDates
            checkIn={draft.checkIn}
            checkOut={draft.checkOut}
            onChange={patch}
            showError={show('range')}
          />
          <UnitPicker
            property={p}
            whole={draft.whole}
            unitIds={draft.unitIds}
            onChange={patch}
            showError={show('units')}
          />
          <TakenAlert quote={quote.data} />
        </SheetSection>

        {block ? (
          <SheetSection title={t('lodging.sheet.blockReason')}>
            <Input
              aria-label={t('lodging.sheet.blockReason')}
              maxLength={300}
              value={draft.blockReason}
              aria-invalid={show('blockReason') || undefined}
              onBlur={blur('blockReason')}
              onChange={(e) => patch({ blockReason: e.target.value })}
            />
            {show('blockReason') && (
              <p className="text-xs text-destructive">{t('lodging.sheet.required')}</p>
            )}
          </SheetSection>
        ) : (
          <>
            <SheetSection title={t('lodging.sheet.sectionGuest')}>
              <PartyInput value={draft.party} onChange={(party) => patch({ party })} />
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${id}-name`} className="text-xs">
                    {t('lodging.sheet.guestName')}
                  </Label>
                  <Input
                    id={`${id}-name`}
                    className="h-8"
                    maxLength={200}
                    value={draft.guestName}
                    aria-invalid={show('guestName') || undefined}
                    onBlur={blur('guestName')}
                    onChange={(e) => patch({ guestName: e.target.value })}
                  />
                  {show('guestName') && (
                    <p className="text-xs text-destructive">{t('lodging.sheet.required')}</p>
                  )}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${id}-phone`} className="text-xs">
                    {t('lodging.sheet.guestPhone')}
                  </Label>
                  <Input
                    id={`${id}-phone`}
                    className="h-8 tabular-nums"
                    type="tel"
                    maxLength={30}
                    value={draft.guestPhone}
                    onChange={(e) => patch({ guestPhone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-source`} className="text-xs">
                  {t('lodging.sheet.source')}
                </Label>
                <Select
                  value={draft.source}
                  onValueChange={(v) => patch({ source: v as BookingSource })}
                >
                  <SelectTrigger id={`${id}-source`} size="sm" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BookingSourceEnum.options.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`lodging.source.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SheetSection>
            <SheetSection title={t('lodging.sheet.sectionPrice')}>
              <QuoteBreakdown
                quote={quote.data}
                loading={quote.isFetching}
                failed={quote.isError}
                checkIn={draft.checkIn}
                checkOut={draft.checkOut}
                standard={p ? { adults: p.standardAdults, children: p.standardChildren } : null}
                price={draft}
                onPriceChange={patch}
              />
            </SheetSection>
            <SheetSection title={t('lodging.sheet.sectionNote')}>
              <Textarea
                aria-label={t('lodging.sheet.note')}
                maxLength={2000}
                rows={2}
                value={draft.note}
                onChange={(e) => patch({ note: e.target.value })}
              />
            </SheetSection>
          </>
        )}
        <BookingErrorAlert error={create.error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="submit" disabled={create.isPending}>
          <SavingLabel saving={create.isPending}>{t(SUBMIT_LABEL[draft.kind])}</SavingLabel>
        </Button>
      </div>
    </form>
  );
}
