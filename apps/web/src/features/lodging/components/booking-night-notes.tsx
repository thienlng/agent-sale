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

/** The open editor: its nights, its text and the units it writes (null = the property). */
type Editor = { nights: ReadonlySet<string>; text: string; targets: Array<string | null> };

/** A night to edit from the calendar: the night and the unit of the clicked cell. */
export type NoteFocus = { night: string; unitId: string | null };

/**
 * "Ghi chú ngày" of a booking: the staff-only notes on its nights (its rooms, or the property
 * for a whole booking, plus the room notes of its rooms on a rooms property), with add / edit /
 * delete for `orders.manage`. A new note is written to every chosen night of every target, as
 * in the create sheet; editing a note changes only that note's unit. `focus` (from the calendar
 * tooltip) opens the editor on that night and cell unit and moves focus here.
 */
export function BookingNightNotes({
  booking: b,
  focus,
}: {
  booking: BookingDetail;
  focus?: NoteFocus | undefined;
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
  /** Units whose notes are listed: the targets, and the rooms of a whole rooms booking. */
  const listed = useMemo(() => {
    if (property?.sellMode !== 'rooms' || !b.whole) return targets;
    const rooms = b.unitIds.length ? b.unitIds : property.rows.map((r) => r.unitId);
    return [...targets, ...rooms];
  }, [property, b.whole, b.unitIds, targets]);
  const notes = useMemo(
    () =>
      (property?.notes ?? [])
        .filter((n) => listed.includes(n.unitId) && nights.includes(n.night))
        .sort((x, y) => x.night.localeCompare(y.night)),
    [property, listed, nights],
  );
  const roomName = (unitId: string | null) =>
    unitId ? (property?.rows.find((r) => r.unitId === unitId)?.name ?? '') : '';
  const label = (night: string) => `${weekdayShort(t, night)} ${dayMonth(night)}`;

  const [editor, setEditor] = useState<Editor | null>(null);
  const section = useRef<HTMLElement>(null);
  const focusPending = useRef(false);
  const focused = useRef(false);

  const open = (chosen: string[], to: Array<string | null> = targets) =>
    setEditor({
      nights: new Set(chosen),
      text: existingNotes(notes, to, chosen).prefill,
      targets: to,
    });

  // Coming from the calendar's "Sửa ghi chú": scroll here and edit that cell's note once loaded.
  useEffect(() => {
    if (!focus || focused.current || !property) return;
    focused.current = true;
    section.current?.scrollIntoView?.({ block: 'start' });
    if (canManage && nights.includes(focus.night)) {
      focusPending.current = true;
      const to = listed.includes(focus.unitId) ? [focus.unitId] : targets;
      setEditor({
        nights: new Set([focus.night]),
        text: existingNotes(property.notes, to, [focus.night]).prefill,
        targets: to,
      });
    } else section.current?.focus();
  }, [focus, property, canManage, nights, listed, targets]);

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
  const existing = existingNotes(notes, editor?.targets ?? targets, chosen);
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
            const date = room ? `${label(n.night)} · ${room}` : label(n.night);
            return (
              <li key={n.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs tabular-nums text-muted-foreground">{date}</p>
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
                        open([n.night], [n.unitId]);
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
            if (chosen.length && editor.text.trim())
              write(editor.targets, chosen, editor.text.trim());
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
                onClick={() => write(editor.targets, chosen, '')}
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
