import type { BotView } from './bot.facade.js';

const VN_OFFSET_MINUTES = 7 * 60; // Asia/Ho_Chi_Minh has no daylight saving time.

/** Whether the bot may answer at `now` under `schedule` (`[start, end)`, Vietnam time). */
export function withinReplySchedule(
  schedule: NonNullable<BotView['replySchedule']>,
  now: Date,
): boolean {
  if (schedule.mode === 'always') return true;
  const minutes = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const local = (now.getUTCHours() * 60 + now.getUTCMinutes() + VN_OFFSET_MINUTES) % 1440;
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);
  return start < end ? local >= start && local < end : local >= start || local < end;
}
