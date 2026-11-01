import { formatVnd } from '@agent-sales/shared';

import { isoWeekday, nightsBetween } from './nights.js';

/**
 * Customer-facing Vietnamese texts of bot holds (T-161): weekday labels and the hold summary the
 * server sends before the customer confirms. Every weekday the bot states comes from here, never
 * from the model.
 */

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Thứ Hai',
  2: 'Thứ Ba',
  3: 'Thứ Tư',
  4: 'Thứ Năm',
  5: 'Thứ Sáu',
  6: 'Thứ Bảy',
  7: 'Chủ Nhật',
};
const SHORT_WEEKDAY_LABELS: Record<number, string> = {
  1: 'T2',
  2: 'T3',
  3: 'T4',
  4: 'T5',
  5: 'T6',
  6: 'T7',
  7: 'CN',
};
const MAX_NAME_CHARS = 120;
const MAX_NOTE_CHARS = 300;

/** 'Thứ Sáu' for a Friday night ('YYYY-MM-DD'). */
export function weekdayLabel(night: string): string {
  return WEEKDAY_LABELS[isoWeekday(night)] ?? '';
}

/** 'T6' for a Friday, 'CN' for a Sunday. */
export function shortWeekdayLabel(night: string): string {
  return SHORT_WEEKDAY_LABELS[isoWeekday(night)] ?? '';
}

/** '2 giờ', '30 phút', '1 giờ 30 phút'. */
export function holdDurationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} giờ` : '', m ? `${m} phút` : ''].filter(Boolean).join(' ');
}

export interface HoldSummaryInput {
  propertyName: string;
  whole: boolean;
  /** Rooms of a per-room selection (ignored for a whole rental). */
  unitNames: string[];
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  totalSell: number;
  guestName: string;
  /** National form `0xxxxxxxxx`. */
  guestPhone: string;
  holdMinutes: number;
  note: string;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** '06/11 (T6)'. */
function day(night: string): string {
  return `${night.slice(8, 10)}/${night.slice(5, 7)} (${shortWeekdayLabel(night)})`;
}

/** `0912345678` → `0912 345 678`; anything else as given. */
function phoneText(phone: string): string {
  return /^0\d{9}$/.test(phone)
    ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`
    : phone;
}

function partyText(adults: number, childAges: number[]): string {
  const kids = childAges.length
    ? `, ${childAges.length} trẻ em (${childAges.join(', ')} tuổi)`
    : '';
  return `${adults} người lớn${kids}`;
}

/** The fixed hold summary the customer agrees to (spec §3); never guesses how to address them. */
export function buildHoldSummary(input: HoldSummaryInput): string {
  const rooms =
    !input.whole && input.unitNames.length ? ` · phòng ${input.unitNames.join(', ')}` : '';
  const note = clip(input.note, MAX_NOTE_CHARS);
  return [
    `Giữ chỗ ${clip(input.propertyName, MAX_NAME_CHARS)}${rooms}`,
    `${day(input.checkIn)} → ${day(input.checkOut)} · ${nightsBetween(input.checkIn, input.checkOut).length} đêm`,
    partyText(input.adults, input.childAges),
    `Tổng: ${formatVnd(input.totalSell)}`,
    `Tên: ${clip(input.guestName, MAX_NAME_CHARS)} · SĐT: ${phoneText(input.guestPhone)}`,
    ...(note ? [`Ghi chú: ${note}`] : []),
    `Giữ trong ${holdDurationText(input.holdMinutes)}, nhân viên sẽ gọi xác nhận.`,
  ].join('\n');
}
