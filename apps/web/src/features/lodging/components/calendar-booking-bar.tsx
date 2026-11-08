import { StickyNote, Tag } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { CalendarSegmentData } from '../lib/calendar-model';
import { clockTime } from '../lib/format';
import { STATUS_STYLE } from './booking-status-badge';

/** A hold this close to its expiry shows a red cue (grid bars, property calendar). */
export const HOLD_WARN_MS = 15 * 60_000;

/** Small dot in the corner of a cell that has a night note (above the booking bar). */
export function NoteDot() {
  return (
    <span
      aria-hidden
      data-note-dot=""
      className="pointer-events-none absolute top-0.5 right-0.5 z-[3] size-1.5 rounded-full bg-primary"
    />
  );
}

/** Bar label: the guest, code and packages of a stay, or the reason of a block. */
export function barLabel(s: CalendarSegmentData): string {
  return s.kind === 'block'
    ? s.blockReason || s.code
    : [s.guestName, s.code, ...s.packageNames].join(' · ');
}

/**
 * One booking drawn over the cells it takes (decorative: the cells under it are the buttons).
 * Status by colour, pattern, icon and text; a hold under 15 minutes from expiry turns red.
 */
export function BookingBar({
  segment: s,
  now,
  style,
  className,
}: {
  segment: CalendarSegmentData;
  now: number;
  style: CSSProperties;
  className?: string;
}) {
  const { t } = useTranslation('lodging');
  const look = STATUS_STYLE[s.status];
  const Icon = look.icon;
  const urgent =
    s.status === 'hold' &&
    s.holdExpiresAt !== null &&
    new Date(s.holdExpiresAt).getTime() - now < HOLD_WARN_MS;
  const label = barLabel(s);
  return (
    <div
      aria-hidden
      title={label}
      style={style}
      className={cn(
        '@container pointer-events-none z-[2] mx-0.5 flex h-7 min-w-0 items-center gap-1 self-center overflow-hidden rounded-md border px-1.5 text-xs',
        look.className,
        // Short bars hide the status text, so the urgency stays on the border and icon.
        urgent && 'border-destructive',
        className,
      )}
    >
      <Icon className={cn('size-3 shrink-0', urgent && 'text-destructive')} />
      {/* The guest · code keeps ~6rem; the status text hides first. */}
      <span className="min-w-[min(6rem,100%)] shrink truncate font-medium">{label}</span>
      <span
        className={cn(
          'hidden min-w-0 shrink-[999] truncate @min-[10rem]:inline',
          urgent && 'font-semibold text-destructive',
        )}
      >
        {t(`bookingStatus.${s.status}`)}
        {s.status === 'hold' && s.holdExpiresAt
          ? ` · ${t('cal.holdExpires', { time: clockTime(s.holdExpiresAt) })}`
          : ''}
      </span>
      {s.note && <StickyNote data-marker="note" className="size-3 shrink-0" />}
      {s.tags.length > 0 && (
        <span
          data-marker="tags"
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums"
        >
          <Tag className="size-3" />
          {s.tags.length}
        </span>
      )}
    </div>
  );
}
