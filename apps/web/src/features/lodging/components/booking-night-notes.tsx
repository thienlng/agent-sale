import type { BookingDetail } from '@agent-sales/contracts';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useCan } from '@/lib/permissions';

import { useLodgingCalendar, useSaveNightNotes } from '../api/calendar';
import { addDays, dayMonth, weekdayShort } from '../lib/format';
import { existingNotes, NightNoteFields, noteNights, noteTargets } from './night-note-fields';

/** The calendar endpoint serves at most 62 nights. */
const MAX_CALENDAR_NIGHTS = 62;

/** Element id of the section, so the calendar can scroll the booking sheet to it. */
export const NIGHT_NOTES_SECTION_ID = 'booking-night-notes';

type Editor = { nights: ReadonlySet<string>; text: string };

/**
 * "Ghi chú ngày" of a booking: the staff-only notes on its nights (its rooms, or the property
 * for a whole booking), with add / edit / delete for `orders.manage`. One text is written to
 * every chosen night, as in the create sheet. `focusNight` (from the calendar tooltip) opens
 * the editor on that night and moves focus here.
 */
export function BookingNightNotes({
  booking: b,
  focusNight,
}: {
  booking: BookingDetail;
  focusNight?: string | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  const canManage = useCan('orders.manage');
  const save = useSaveNightNotes();
  const nights = useMemo(
    () => noteNights(b.checkIn, b.checkOut).slice(0, MAX_CALENDAR_NIGHTS),
    [b.checkIn, b.checkOut],
  );
  const propertyIds = useMemo(() => [b.propertyId], [b.propertyId]);
  const calendar = useLodgingCalendar({
    from: b.checkIn,
    to: nights.length ? addDays(b.checkIn, nights.length) : b.checkOut,
    propertyIds,
  });
  const property = calendar.data?.properties.find((p) => p.id === b.propertyId);
  const targets = useMemo(() => noteTargets(property, b), [property, b]);
  const notes = useMemo(
    () =>
      (property?.notes ?? [])
        .filter((n) => targets.includes(n.unitId) && nights.includes(n.night))
        .sort((x, y) => x.night.localeCompare(y.night)),
    [property, targets, nights],
  );
  const roomName = (unitId: string | null) =>
    unitId ? (property?.rows.find((r) => r.unitId === unitId)?.name ?? '') : '';
  const label = (night: string) => `${weekdayShort(t, night)} ${dayMonth(night)}`;

  const [editor, setEditor] = useState<Editor | null>(null);
  const section = useRef<HTMLElement>(null);
  const focusPending = useRef(false);
  const focused = useRef(false);

  const open = (chosen: string[]) =>
    setEditor({ nights: new Set(chosen), text: existingNotes(notes, targets, chosen).prefill });

  // Coming from the calendar's "Sửa ghi chú": scroll here and edit that night once loaded.
  useEffect(() => {
    if (!focusNight || focused.current || !property) return;
    focused.current = true;
    section.current?.scrollIntoView?.({ block: 'start' });
    if (canManage && nights.includes(focusNight)) {
      focusPending.current = true;
      setEditor({
        nights: new Set([focusNight]),
        text: existingNotes(property.notes, targets, [focusNight]).prefill,
      });
    } else section.current?.focus();
  }, [focusNight, property, canManage, nights, targets]);

  useEffect(() => {
    if (!editor || !focusPending.current) return;
    focusPending.current = false;
    section.current?.querySelector('textarea')?.focus();
  }, [editor]);

  const write = (unitIds: Array<string | null>, chosen: string[], text: string) => {
    if (save.isPending || !property) return;
    save.mutate(
      { propertyId: b.propertyId, unitIds, nights: chosen, text },
      {
        onSuccess: () => {
          toast.success(t(text ? 'lodging.sheet.noteSaved' : 'lodging.sheet.noteDeleted'), {
            duration: 3500,
          });
          setEditor(null);
        },
        onError: () => toast.error(t('lodging.sheet.noteError')),
      },
    );
  };

  const chosen = editor ? nights.filter((n) => editor.nights.has(n)) : [];
  const existing = existingNotes(notes, targets, chosen);
  const toggleNight = (night: string, on: boolean) =>
    setEditor((e) => {
      if (!e) return e;
      const next = new Set(e.nights);
      if (on) next.add(night);
      else next.delete(night);
      return { ...e, nights: next };
    });

  return (
    <section
      ref={section}
      id={NIGHT_NOTES_SECTION_ID}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-2 gap-2 outline-none"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={`${id}-title`}
          className="text-xs font-semibold tracking-wide text-muted-foreground"
        >
          {t('lodging.sheet.sectionNightNotes')}
        </h3>
        {canManage && !editor && property && nights.length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => open(nights)}>
            <Plus aria-hidden />
            {t('lodging.sheet.addNightNote')}
          </Button>
        )}
      </div>

      {calendar.isError ? (
        <p className="text-muted-foreground">{t('lodging.sheet.nightNotesLoadError')}</p>
      ) : notes.length === 0 ? (
        property && <p className="text-muted-foreground">{t('lodging.sheet.nightNotesEmpty')}</p>
      ) : (
        <ul className="grid gap-1.5">
          {notes.map((n) => {
            const room = roomName(n.unitId);
            const date = label(n.night);
            return (
              <li key={n.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {date}
                    {room && ` · ${room}`}
                  </p>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                </div>
                {canManage && (
                  <>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t('lodging.sheet.editNightNoteOf', { date })}
                      disabled={save.isPending}
                      onClick={() => {
                        focusPending.current = true;
                        open([n.night]);
                      }}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      aria-label={t('lodging.sheet.deleteNightNoteOf', { date })}
                      disabled={save.isPending}
                      onClick={() => write([n.unitId], [n.night], '')}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && editor && (
        <form
          className="grid gap-2 rounded-md border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen.length && editor.text.trim()) write(targets, chosen, editor.text.trim());
          }}
        >
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-xs font-medium">
              {t('lodging.sheet.nightNoteNights')}
            </legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {nights.map((night) => (
                <div key={night} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`${id}-n-${night}`}
                    checked={editor.nights.has(night)}
                    onCheckedChange={(v) => toggleNight(night, v === true)}
                  />
                  <Label htmlFor={`${id}-n-${night}`} className="text-xs tabular-nums">
                    {label(night)}
                  </Label>
                </div>
              ))}
            </div>
            {chosen.length === 0 && (
              <p className="text-xs text-destructive">{t('lodging.sheet.nightNoteNoNight')}</p>
            )}
          </fieldset>
          <NightNoteFields
            value={editor.text}
            onChange={(text) => setEditor((e) => (e ? { ...e, text } : e))}
            mixed={existing.mixed}
          />
          <div className="flex justify-end gap-2">
            {existing.any && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                disabled={save.isPending}
                onClick={() => write(targets, chosen, '')}
              >
                {t('lodging.sheet.deleteNote')}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setEditor(null)}>
              {t('lodging.sheet.cancelEdit')}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={save.isPending || chosen.length === 0 || !editor.text.trim()}
            >
              {t('lodging.sheet.saveNote')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
