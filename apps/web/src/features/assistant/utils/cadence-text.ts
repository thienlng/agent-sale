import type { Cadence } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

/** Weekdays in order, Monday = 1 … Sunday = 7. */
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** An interval in words: "15 phút", "2 giờ", "1 ngày". */
export function intervalText(minutes: number, t: TFunction<'assistant'>): string {
  if (minutes % 1440 === 0) return t('schedules.cadence.days', { count: minutes / 1440 });
  if (minutes % 60 === 0) return t('schedules.cadence.hours', { count: minutes / 60 });
  return t('schedules.cadence.minutes', { count: minutes });
}

/**
 * A cadence in words, through the `assistant` namespace (local time, Asia/Ho_Chi_Minh):
 * "Hằng ngày lúc 08:00", "Thứ Hai, Thứ Năm hằng tuần lúc 08:00", "Ngày cuối tháng lúc 18:00",
 * "Mỗi 30 phút (08:00–22:00)".
 */
export function cadenceText(cadence: Cadence, t: TFunction<'assistant'>): string {
  switch (cadence.kind) {
    case 'daily':
      return t('schedules.cadence.daily', { at: cadence.at });
    case 'weekly': {
      const days = [...cadence.days].sort((a, b) => a - b);
      if (days.length === ALL_DAYS.length) return t('schedules.cadence.daily', { at: cadence.at });
      return t('schedules.cadence.weekly', {
        days: days.map((d) => t(`schedules.weekdays.${d}`)).join(', '),
        at: cadence.at,
      });
    }
    case 'monthly':
      return cadence.day === -1
        ? t('schedules.cadence.monthlyLast', { at: cadence.at })
        : t('schedules.cadence.monthly', { day: cadence.day, at: cadence.at });
    case 'every': {
      const every = t('schedules.cadence.every', { interval: intervalText(cadence.minutes, t) });
      return cadence.activeFrom && cadence.activeTo
        ? t('schedules.cadence.activeHours', {
            every,
            from: cadence.activeFrom,
            to: cadence.activeTo,
          })
        : every;
    }
  }
}
