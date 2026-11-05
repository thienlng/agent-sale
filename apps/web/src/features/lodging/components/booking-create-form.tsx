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
import { useSaveNightNotes } from '../api/calendar';
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
import {
  PackagePicker,
  SavingLabel,
  SheetSection,
  StayDates,
  TakenAlert,
  UnitPicker,
} from './booking-fields';
import { existingNotes, NightNoteFields, noteNights, noteTargets } from './night-note-fields';
import { PartyInput } from './party-input';
import { QuoteBreakdown } from './quote-breakdown';
import { TagInput } from './tag-input';

type SheetTab = CreateKind | 'note';

const SUBMIT_LABEL: Record<CreateKind, string> = {
  hold: 'sheet.submitHold',
  confirmed: 'sheet.submitConfirmed',
  block: 'sheet.submitBlock',
};

/**
 * Create mode of the booking sheet: Giữ chỗ / Đặt luôn / Khoá lịch with a live quote, and
 * "Ghi chú" to write a staff-only note on each selected night instead of a booking.
 */
export function BookingCreateForm({
  initial,
  onCreated,
  onClose,
}: {
  initial: BookingCreateInitial | undefined;
  onCreated: (booking: BookingDetail) => void;
  /** Closes the sheet after a night note was saved. */
  onClose: () => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const { draft, patch, quote, packageTargets, packageIds } = useBookingDraft(initial);
  const properties = useProperties();
  const property = useProperty(draft.propertyId || undefined);
  const create = useCreateBooking();
  const saveNotes = useSaveNightNotes();
  const [tab, setTab] = useState<SheetTab>(draft.kind);
  const [noteText, setNoteText] = useState('');
  // One id per attempt until it succeeds, so a retried submit cannot create two bookings.
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const errors = validateDraft(draft);
  const show = (field: keyof typeof errors) =>
    Boolean(errors[field]) && (submitted || touched.has(field));
  const blur = (field: string) => () => setTouched((s) => new Set(s).add(field));
  const block = draft.kind === 'block';
  const noteMode = tab === 'note';
  const p = property.data;
  const targets = noteTargets(p, draft);
  const nights = noteNights(draft.checkIn, draft.checkOut);
  const existing = existingNotes(
    draft.propertyId === initial?.propertyId ? (initial?.nightNotes ?? []) : [],
    targets,
    nights,
  );

  const openTab = (next: SheetTab) => {
    // Entering "Ghi chú" starts from the note already on those nights (when they agree).
    if (next === 'note') setNoteText(existing.prefill);
    else patch({ kind: next });
    setTab(next);
  };

  const writeNote = (text: string) => {
    if (saveNotes.isPending || !draft.propertyId || nights.length === 0 || targets.length === 0)
      return;
    saveNotes.mutate(
      { propertyId: draft.propertyId, unitIds: targets, nights, text },
      {
        onSuccess: () => {
          toast.success(t(text ? 'sheet.noteSaved' : 'sheet.noteDeleted'), {
            duration: 3500,
          });
          onClose();
        },
        onError: () => toast.error(t('sheet.noteError')),
      },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (noteMode) {
      if (!errors.property && !errors.range && !errors.units) writeNote(noteText.trim());
      return;
    }
    if (Object.keys(errors).length > 0 || create.isPending) return;
    create.mutate(
      createRequest(
        draft,
        clientRequestId,
        {
          contactId: initial?.contactId ?? null,
          conversationId: initial?.conversationId ?? null,
        },
        packageIds,
      ),
      {
        onSuccess: (booking) => {
          setClientRequestId(crypto.randomUUID());
          toast.success(t('sheet.created', { code: booking.code }), { duration: 3500 });
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
        <Tabs value={tab} onValueChange={(v) => openTab(v as SheetTab)}>
          <TabsList aria-label={t('sheet.kind')} className="w-full">
            <TabsTrigger value="hold">{t('sheet.tabHold')}</TabsTrigger>
            <TabsTrigger value="confirmed">{t('sheet.tabConfirmed')}</TabsTrigger>
            <TabsTrigger value="block">{t('sheet.tabBlock')}</TabsTrigger>
            <TabsTrigger value="note">{t('sheet.tabNote')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <SheetSection title={t('sheet.sectionDates')}>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-property`} className="text-xs">
              {t('sheet.property')}
            </Label>
            <Select
              value={draft.propertyId}
              onValueChange={(propertyId) =>
                patch({ propertyId, whole: true, unitIds: [], packageChoice: {} })
              }
            >
              <SelectTrigger
                id={`${id}-property`}
                className="w-full"
                aria-invalid={show('property') || undefined}
              >
                <SelectValue placeholder={t('sheet.chooseProperty')}>
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
            {show('property') && <p className="text-xs text-destructive">{t('sheet.required')}</p>}
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
          {!noteMode && !block && (
            <PackagePicker
              property={p}
              targets={packageTargets}
              choice={draft.packageChoice}
              quote={quote.data}
              onChange={(packageChoice) => patch({ packageChoice })}
            />
          )}
          {!noteMode && <TakenAlert quote={quote.data} />}
        </SheetSection>

        {noteMode ? (
          <SheetSection title={t('sheet.sectionNote')}>
            <NightNoteFields value={noteText} onChange={setNoteText} mixed={existing.mixed} />
          </SheetSection>
        ) : block ? (
          <SheetSection title={t('sheet.blockReason')}>
            <Input
              aria-label={t('sheet.blockReason')}
              maxLength={300}
              value={draft.blockReason}
              aria-invalid={show('blockReason') || undefined}
              onBlur={blur('blockReason')}
              onChange={(e) => patch({ blockReason: e.target.value })}
            />
            {show('blockReason') && (
              <p className="text-xs text-destructive">{t('sheet.required')}</p>
            )}
          </SheetSection>
        ) : (
          <>
            <SheetSection title={t('sheet.sectionGuest')}>
              <PartyInput value={draft.party} onChange={(party) => patch({ party })} />
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`${id}-name`} className="text-xs">
                    {t('sheet.guestName')}
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
                    <p className="text-xs text-destructive">{t('sheet.required')}</p>
                  )}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${id}-phone`} className="text-xs">
                    {t('sheet.guestPhone')}
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
                  {t('sheet.source')}
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
                        {t(`source.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SheetSection>
            <SheetSection title={t('sheet.sectionPrice')}>
              <QuoteBreakdown
                quote={quote.data}
                loading={quote.isFetching}
                failed={quote.isError}
                checkIn={draft.checkIn}
                checkOut={draft.checkOut}
                standard={p ? { adults: p.standardAdults, children: p.standardChildren } : null}
                property={p}
                price={draft}
                onPriceChange={patch}
              />
            </SheetSection>
            <SheetSection title={t('sheet.sectionNote')}>
              <Textarea
                aria-label={t('sheet.note')}
                maxLength={2000}
                rows={2}
                value={draft.note}
                onChange={(e) => patch({ note: e.target.value })}
              />
              <TagInput value={draft.tags} onChange={(tags) => patch({ tags })} />
            </SheetSection>
          </>
        )}
        {!noteMode && <BookingErrorAlert error={create.error} />}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        {noteMode ? (
          <>
            {existing.any && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                disabled={saveNotes.isPending}
                onClick={() => writeNote('')}
              >
                {t('sheet.deleteNote')}
              </Button>
            )}
            <Button type="submit" disabled={saveNotes.isPending || !noteText.trim()}>
              <SavingLabel saving={saveNotes.isPending}>{t('sheet.saveNote')}</SavingLabel>
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={create.isPending}>
            <SavingLabel saving={create.isPending}>{t(SUBMIT_LABEL[draft.kind])}</SavingLabel>
          </Button>
        )}
      </div>
    </form>
  );
}
