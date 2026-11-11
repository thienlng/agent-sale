import { BRAIN_IDLE_MINUTES } from '@agent-sales/contracts';

/** Per-business Brain settings (`brain_settings`); a missing row means `DEFAULT_BRAIN_SETTINGS`. */
export interface BrainSettings {
  mode: 'auto' | 'manual';
  idleMinutes: number;
  briefingEnabled: boolean;
  briefingHour: number;
}

export const DEFAULT_BRAIN_SETTINGS: BrainSettings = {
  mode: 'auto',
  idleMinutes: BRAIN_IDLE_MINUTES.default,
  briefingEnabled: true,
  briefingHour: 8,
};

/** A claimed job holds this lease; a crashed worker's job is claimed again after it. */
export const JOB_LEASE_MS = 2 * 60_000;
/** A failed evaluation is retried this much later, at most `MAX_JOB_ATTEMPTS` times. */
export const JOB_RETRY_MS = 10 * 60_000;
export const MAX_JOB_ATTEMPTS = 3;
/** Default daily cap when the plan does not define `brain.evaluations.daily`. */
export const DEFAULT_DAILY_EVALUATIONS = 200;

/** Asia/Ho_Chi_Minh is UTC+7 all year (no daylight saving time). */
const HCM_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** The calendar day in Asia/Ho_Chi_Minh, as `YYYY-MM-DD` (the cap's counting day). */
export function hcmDay(now: Date): string {
  return new Date(now.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

/** The local hour (0–23) in Asia/Ho_Chi_Minh: the morning briefing's clock. */
export function hcmHour(now: Date): number {
  return new Date(now.getTime() + HCM_OFFSET_MS).getUTCHours();
}

/** The next local midnight in Asia/Ho_Chi_Minh: a capped job waits until then. */
export function nextHcmMidnight(now: Date): Date {
  const local = now.getTime() + HCM_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - HCM_OFFSET_MS);
}

/**
 * When the idle evaluation of a conversation runs after a customer message at `at` (brief rule
 * 1): the conversation must stay quiet for `idleMinutes`, and a later message only pushes the
 * run back, never forward (an older event processed late does not pull it in).
 */
export function nextRunAfter(existing: Date | null, at: Date, idleMinutes: number): Date {
  const due = at.getTime() + idleMinutes * 60_000;
  return new Date(Math.max(existing?.getTime() ?? Number.NEGATIVE_INFINITY, due));
}

/** Only a customer message schedules an evaluation; Page echoes (staff) and bot replies do not. */
export function isCustomerMessage(eventType: string): boolean {
  return eventType !== 'echo';
}

export type SkipReason = 'manual_mode' | 'test' | 'closed' | 'nothing_new';

/**
 * Why a due idle job must not call the model (brief rule 2), or null to evaluate. Every skip
 * drops the job: a newer customer message schedules a fresh one.
 */
export function shouldSkip(input: {
  mode: BrainSettings['mode'];
  isTest: boolean;
  status: 'open' | 'resolved' | 'spam';
  hasNewCustomerMessage: boolean;
}): SkipReason | null {
  if (input.mode === 'manual') return 'manual_mode';
  if (input.isTest) return 'test';
  if (input.status !== 'open') return 'closed';
  if (!input.hasNewCustomerMessage) return 'nothing_new';
  return null;
}
