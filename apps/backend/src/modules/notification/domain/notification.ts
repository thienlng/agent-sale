/**
 * In-app notifications and their email/push deliveries (T-172, S3-R5…R8). In-app delivery is
 * the notification row itself; every other channel is one delivery row.
 */

export type NotificationType =
  | 'assistant.report'
  | 'assistant.alert'
  | 'assistant.schedule_paused'
  | 'inbox.handoff'
  | 'inbox.message';
export type NotificationChannelKind = 'email' | 'push';
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export type NotificationTarget =
  | { kind: 'path'; path: string }
  | { kind: 'assistant_report'; runId: string }
  /** One inbox conversation of the notification's business (T-190). */
  | { kind: 'conversation'; conversationId: string };

/**
 * The in-app link of a target, for a push (relative, opened by the installed app): a path as is,
 * a conversation as `/app/inbox?conversation=…&ws=…` (the app switches to that business first).
 */
export function targetHref(target: NotificationTarget | null, workspaceId: string | null): string {
  if (target?.kind === 'path') return target.path;
  if (target?.kind === 'conversation') {
    const ws = workspaceId ? `&ws=${workspaceId}` : '';
    return `/app/inbox?conversation=${target.conversationId}${ws}`;
  }
  return '/app';
}

export const NOTIFICATION_TITLE_MAX = 160;
export const NOTIFICATION_BODY_MAX = 4000;
export const NOTIFICATION_DEDUP_KEY_MAX = 160;

/**
 * Minutes to wait before each retry: a failed send is retried 3 times (1, 5 and 30 minutes
 * later); when the 3rd retry fails too, the delivery is `failed`.
 */
export const RETRY_MINUTES = [1, 5, 30] as const;
/** Send attempts in all (the first send plus the retries) before a delivery is `failed`. */
export const MAX_DELIVERY_ATTEMPTS = RETRY_MINUTES.length + 1;
/** Emails per user per rolling 24 h (S3-R7). */
export const EMAIL_DAILY_CAP = 20;
/** Notifications (and their deliveries) are kept this long. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/** When a failed attempt number `attempts` (1-based) may be retried, or null when it is final. */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const minutes = RETRY_MINUTES[attempts - 1] ?? RETRY_MINUTES[RETRY_MINUTES.length - 1];
  return new Date(now.getTime() + (minutes ?? 1) * 60_000);
}

const MAX_DECODE_PASSES = 3;
const isAppPath = (path: string) =>
  /^\/app(\/|$)/.test(path) && !path.split('/').some((s) => s === '..' || s === '.');

/**
 * A `path` target, accepted only when it stays inside the dashboard: the same rule as the web's
 * `safeAppPath`. Decoded until stable, no `%`, query, hash, backslash or control character, no
 * `//`, and `/app` or `/app/…` without dot segments.
 */
export function isSafeAppPath(to: string): boolean {
  if (to.length > 300) return false;
  let decoded = to;
  try {
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return false;
  }
  if (/[%?#\\]/.test(decoded) || [...decoded].some((c) => c.charCodeAt(0) < 0x20)) return false;
  return !decoded.includes('//') && isAppPath(decoded) && decoded === to;
}
