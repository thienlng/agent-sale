import { Pencil, StickyNote } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { CalendarSegmentData } from '../lib/calendar-model';
import { clockTime, formatVnd, localDayMonth } from '../lib/format';

/** Hover delay of grid tooltips, so sweeping the mouse over the grid stays quiet. */
const CELL_TIP_DELAY_MS = 350;
const NOTE_EXCERPT = 140;

const excerpt = (text: string) =>
  text.length > NOTE_EXCERPT ? `${text.slice(0, NOTE_EXCERPT).trimEnd()}…` : text;

/**
 * Wraps a grid cell button in a tooltip (hover after a short delay, or keyboard focus at once).
 * Without content the cell is returned as is.
 */
export function CellTip({ content, children }: { content: ReactNode; children: ReactElement }) {
  if (!content) return children;
  return (
    <Tooltip delayDuration={CELL_TIP_DELAY_MS}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="grid max-w-72 justify-items-start gap-0.5 text-left">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Night note line of a cell tooltip. Hidden from screen readers: the cell's aria-label already
 * carries the note, and the tooltip is the cell's description, so it would be read twice.
 */
export function NightNoteTip({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <span aria-hidden className="whitespace-pre-wrap">
      <span className="font-semibold">{t('lodging.cal.nightNote')}: </span>
      {text}
    </span>
  );
}

/**
 * Booking quick view on a taken cell: guest, phone, party, total, hold expiry, tags and the
 * start of the booking note (blocks: their reason). A click on the cell opens the full sheet;
 * `onEditNote` adds a "Sửa ghi chú" action (mouse only: keyboard users reach the same
 * "Ghi chú ngày" section from the sheet the cell opens).
 */
export function BookingQuickView({
  segment: s,
  nightNote,
  onEditNote,
}: {
  segment: CalendarSegmentData;
  nightNote: string | undefined;
  onEditNote?: () => void;
}) {
  const { t } = useTranslation();
  const status = t(`lodging.bookingStatus.${s.status}`);
  return (
    <>
      {s.kind === 'block' ? (
        <>
          <span className="font-semibold">
            {s.code} · {status}
          </span>
          {s.blockReason && <span>{s.blockReason}</span>}
        </>
      ) : (
        <>
          <span className="font-semibold">
            {s.guestName} · {s.code} · {status}
          </span>
          <span className="tabular-nums">{s.guestPhone || t('lodging.sheet.noGuestPhone')}</span>
          {s.packageNames.length > 0 && (
            <span>{t('lodging.cal.quickPackage', { names: s.packageNames.join(', ') })}</span>
          )}
          <span className="tabular-nums">
            {t('lodging.sheet.guests', {
              adults: s.party.adults,
              children: s.party.childAges.length,
            })}
          </span>
          <span className="tabular-nums">
            {s.totalSell === null
              ? t('lodging.cal.quickNoPrice')
              : t('lodging.cal.quickTotal', { amount: formatVnd(s.totalSell) })}
          </span>
          {s.status === 'hold' && s.holdExpiresAt && (
            <span className="tabular-nums">
              {t('lodging.sheet.holdUntil', {
                time: `${clockTime(s.holdExpiresAt)} ${localDayMonth(s.holdExpiresAt)}`,
              })}
            </span>
          )}
          {s.tags.length > 0 && (
            <span>
              <span className="font-semibold">{t('lodging.tags.label')}: </span>
              {s.tags.join(' · ')}
            </span>
          )}
          {s.note && <span className="whitespace-pre-wrap opacity-90">{excerpt(s.note)}</span>}
        </>
      )}
      {nightNote && <NightNoteTip text={nightNote} />}
      {onEditNote && (
        <span aria-hidden className="mt-1">
          <button
            type="button"
            tabIndex={-1}
            data-action="edit-night-note"
            className="inline-flex items-center gap-1 rounded-sm border border-background/40 px-1.5 py-0.5 font-medium hover:bg-background/15"
            onClick={(e) => {
              e.stopPropagation();
              onEditNote();
            }}
          >
            <Pencil className="size-3" />
            {t(nightNote ? 'lodging.cal.editNightNote' : 'lodging.cal.addNightNote')}
          </button>
        </span>
      )}
    </>
  );
}

/**
 * Staff-only property note as a card: opens on hovering the property name, on focus of the
 * note button and on its click (touch). Never shown to the bot.
 */
export function InternalNoteCard({
  code,
  note,
  children,
}: {
  code: string;
  note: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="flex w-full min-w-0 items-center">
          {children}
          <button
            type="button"
            aria-label={t('lodging.cal.internalNote', { code })}
            aria-expanded={open}
            aria-describedby={noteId}
            className="mr-1 shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={() => setOpen((o) => !o)}
          >
            <StickyNote aria-hidden className="size-3.5" />
          </button>
          <span id={noteId} className="sr-only">
            {note}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="grid w-72 gap-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('lodging.cal.internalNoteTitle')}
        </p>
        <p className="text-sm whitespace-pre-wrap">{note}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
