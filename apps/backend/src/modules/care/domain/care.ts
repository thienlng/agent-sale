import type { CareTemplateKey, SignalStage } from '@agent-sales/contracts';

export type { CareTemplateKey };

/** The templates that send messages (inside the window); `after_sale` only shows on Today. */
export type MessageTemplate = Exclude<CareTemplateKey, 'after_sale'>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Asia/Ho_Chi_Minh is UTC+7 all year (no daylight saving time). */
const HCM_OFFSET_MS = 7 * HOUR;
const DAY_MS = 24 * HOUR;

/**
 * When each step is due, after the customer's last message (the cycle's anchor), spec §3:
 * "Khách im lặng" at +2 h and a last chance at +21 h; "Sắp chốt" at +1 h.
 */
export const TEMPLATE_STEPS: Readonly<Record<MessageTemplate, readonly number[]>> = {
  silent: [2 * HOUR, 21 * HOUR],
  ready: [1 * HOUR],
};

/** The Brain stages each template follows up; any other stage stops it. */
export const TEMPLATE_STAGES: Readonly<Record<MessageTemplate, readonly SignalStage[]>> = {
  silent: ['exploring', 'price_asked'],
  ready: ['ready'],
};

/** Meta's messaging window after the customer's last message (no tags for the agent, ADR-031). */
export const WINDOW_MS = 24 * HOUR;
/** No step is started this close to the window's end (the model call and delivery take time). */
export const WINDOW_MARGIN_MS = 10 * MINUTE;
/** Quiet hours, local time: no agent message from 21:00 to 08:00. */
export const QUIET_FROM_HOUR = 21;
export const QUIET_TO_HOUR = 8;
/** Agent messages per conversation in any 24 hours, at most. */
export const MAX_MESSAGES_PER_24H = 2;
/** Default daily cap when the plan does not define `care.messages.daily`. */
export const DEFAULT_DAILY_CARE_MESSAGES = 100;
/** A message the model writes is at most this long; a longer one is skipped (spec §4). */
export const CARE_MESSAGE_MAX_CHARS = 600;
/** A claimed enrollment holds this lease; a crashed worker's job is claimed again after it. */
export const CARE_LEASE_MS = 2 * MINUTE;
/** A failed model call is retried this much later, at most `CARE_MAX_ATTEMPTS` times. */
export const CARE_RETRY_MS = 10 * MINUTE;
export const CARE_MAX_ATTEMPTS = 3;
/** A due after-sales check-in leaves Today this long after it became due. */
export const AFTER_SALE_LISTED_MS = 7 * DAY_MS;
/** A send that never finished (a crash between claim and delivery) is failed after this. */
export const SENDING_STALE_MS = 10 * MINUTE;

/** Why a cycle ended without (more) messages. */
export type StopReason =
  | 'customer_replied'
  | 'ordered'
  | 'stage_changed'
  | 'member_message'
  | 'taken_over'
  | 'opted_out'
  | 'closed'
  | 'template_off'
  | 'not_answered'
  | 'unsupported_channel'
  | 'window_closed'
  | 'capped'
  | 'ai_failed';

/** The calendar day in Asia/Ho_Chi_Minh, `YYYY-MM-DD` (the cap's counting day). */
export function hcmDay(at: Date): string {
  return new Date(at.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

/** The start of the local day of `at` (midnight Asia/Ho_Chi_Minh), as a UTC instant. */
export function hcmDayStart(at: Date): Date {
  const local = at.getTime() + HCM_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - HCM_OFFSET_MS);
}

/** The next local midnight after `at`. */
export function nextHcmMidnight(at: Date): Date {
  return new Date(hcmDayStart(at).getTime() + DAY_MS);
}

/** Whether `at` falls in the quiet hours (21:00–08:00 Asia/Ho_Chi_Minh). */
export function inQuietHours(at: Date): boolean {
  const hour = new Date(at.getTime() + HCM_OFFSET_MS).getUTCHours();
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR;
}

/** The end of the quiet hours `at` is in (the next local 08:00); `at` itself outside them. */
export function quietHoursEnd(at: Date): Date {
  if (!inQuietHours(at)) return at;
  const start = hcmDayStart(at).getTime();
  const eight = start + QUIET_TO_HOUR * HOUR;
  return new Date(at.getTime() < eight ? eight : eight + DAY_MS);
}

/**
 * When the window of a conversation closes: 24 hours after the customer's last message on
 * Messenger and Instagram. Null for every other channel: the agent does not follow up there
 * (website chat: the visitor is gone; an email follow-up is a later phase).
 */
export function windowClosesAt(provider: string, lastInboundAt: string | null): Date | null {
  if (provider !== 'facebook' && provider !== 'instagram') return null;
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) ? new Date(t + WINDOW_MS) : null;
}

/** The due time of a step after `anchor`, or null when the template has no such step. */
export function stepDue(template: MessageTemplate, step: number, anchor: Date): Date | null {
  const offset = TEMPLATE_STEPS[template][step];
  return offset === undefined ? null : new Date(anchor.getTime() + offset);
}

/**
 * When a step due at `due` may run: moved out of the quiet hours to 08:00, and only while the
 * window is still open (with a margin). Null: it would land outside the window, so the AI does
 * nothing and the customer stays on Today for a person (spec §2).
 */
export function placeInWindow(due: Date, closesAt: Date): Date | null {
  const at = quietHoursEnd(due);
  return at.getTime() < closesAt.getTime() - WINDOW_MARGIN_MS ? at : null;
}

/**
 * The per-conversation limit (≤ 2 agent messages in any 24 hours): null when a message may go at
 * `at`, else the earliest time one may (when the oldest of the last 24 hours leaves the span).
 */
export function nextAllowedAfterLimit(sentAts: readonly Date[], at: Date): Date | null {
  const recent = sentAts
    .filter((s) => s.getTime() > at.getTime() - DAY_MS && s.getTime() <= at.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < MAX_MESSAGES_PER_24H) return null;
  const oldest = recent[recent.length - MAX_MESSAGES_PER_24H];
  return new Date((oldest?.getTime() ?? at.getTime()) + DAY_MS + 1);
}

/** What the stop rules read before every step (spec §3). */
export interface StopInput {
  template: MessageTemplate;
  templateEnabled: boolean;
  /** The customer message the cycle is for. */
  anchorAt: Date;
  facts: {
    status: 'open' | 'resolved' | 'spam';
    mode: 'bot' | 'human';
    lastInboundAt: string | null;
    lastMessageSender: 'customer' | 'human' | 'bot';
    lastHumanAt: string | null;
  };
  signal: { stage: SignalStage; optOut: boolean } | null;
  /** The newest order or stay booking of the conversation. */
  lastOrderAt: Date | null;
}

const after = (iso: string | null, t: Date): boolean =>
  iso !== null && Date.parse(iso) > t.getTime();

/**
 * Why the cycle must stop now, or null to go on (spec §3, checked before every step): the
 * template was turned off; the conversation is closed; the customer opted out; the customer wrote
 * again; an order or booking was made; the stage left the template's stages; a person of the shop
 * wrote or took the conversation; the last message is the customer's (nobody answered them: a
 * person's job, not a follow-up).
 */
export function stopReason(i: StopInput): StopReason | null {
  if (!i.templateEnabled) return 'template_off';
  if (i.facts.status !== 'open') return 'closed';
  if (i.signal?.optOut) return 'opted_out';
  if (after(i.facts.lastInboundAt, i.anchorAt)) return 'customer_replied';
  if (i.lastOrderAt && i.lastOrderAt.getTime() > i.anchorAt.getTime()) return 'ordered';
  if (!i.signal || !TEMPLATE_STAGES[i.template].includes(i.signal.stage)) return 'stage_changed';
  if (after(i.facts.lastHumanAt, i.anchorAt)) return 'member_message';
  if (i.facts.mode === 'human') return 'taken_over';
  if (i.facts.lastMessageSender === 'customer') return 'not_answered';
  return null;
}

/** The message template a Brain stage starts, or null (other stages start nothing). */
export function templateForStage(stage: SignalStage): MessageTemplate | null {
  if (stage === 'exploring' || stage === 'price_asked') return 'silent';
  if (stage === 'ready') return 'ready';
  return null;
}

/** Stages after which no follow-up makes sense. */
export function endsFollowUps(stage: SignalStage): boolean {
  return stage === 'won' || stage === 'lost' || stage === 'spam' || stage === 'after_sale';
}

/** A draft can still be sent while its window is open. */
export function draftExpired(windowClosesAt: Date | null, now: Date): boolean {
  return windowClosesAt !== null && windowClosesAt.getTime() <= now.getTime();
}

/** When the after-sales check-in of an order completed at `completedAt` is due. */
export function afterSaleDueAt(completedAt: Date, days: number): Date {
  return new Date(completedAt.getTime() + days * DAY_MS);
}

/**
 * The idempotency key of a care message's send: one per step of a cycle (enrollment, the
 * customer message it is for, step), so a repeated run or approval never sends a second message.
 */
export function careSendKey(m: {
  id: string;
  enrollmentId: string | null;
  anchorAt: Date;
  step: number;
}): string {
  return m.enrollmentId
    ? `care:${m.enrollmentId}:${m.anchorAt.getTime()}:${m.step}`
    : `care:${m.id}`;
}
