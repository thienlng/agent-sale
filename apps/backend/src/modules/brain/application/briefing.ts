import { type ImpactResponse, TODAY_QUEUES, type TodayQueueKey } from '@agent-sales/contracts';
import { notificationStrings } from '@agent-sales/i18n/notification';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { NOTIFICATION_FACADE, type NotificationFacade } from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { BRAIN_STORE, type BrainStore } from '../domain/ports/brain.store.js';
import { DEFAULT_BRAIN_SETTINGS, hcmDay, hcmHour } from '../domain/schedule.js';
import { TodayExtensions } from './today-extensions.js';
import { TodayQuery } from './today.query.js';

/** Businesses read per page of the scan. */
const PAGE = 500;
const ROLES = new Set(['owner', 'admin']);

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
/** Asia/Ho_Chi_Minh is UTC+7 all year. */
const HCM_OFFSET_MS = 7 * 3_600_000;

/** Monday in Asia/Ho_Chi_Minh: the briefing then carries the 7-day impact (spec care §6). */
export function isHcmMonday(now: Date): boolean {
  return new Date(now.getTime() + HCM_OFFSET_MS).getUTCDay() === 1;
}

/**
 * The weekly impact line ("7 ngày qua Rapiz đã mang lại …"), or null when the AI brought nothing
 * and sent nothing that week. Revenue in the recipient's number format, in VND.
 */
export function impactLine(
  strings: Record<string, string>,
  impact: Pick<ImpactResponse, 'ai' | 'aiStaff' | 'followUpsSent'>,
  locale = 'vi',
): string | null {
  const orders = impact.ai.orders + impact.aiStaff.orders;
  if (orders === 0 && impact.followUpsSent === 0) return null;
  const revenue = `${new Intl.NumberFormat(locale).format(impact.ai.revenue + impact.aiStaff.revenue)} ₫`;
  return fill(strings['today.briefing.impact'] ?? '', {
    orders: String(orders),
    revenue,
    sent: String(impact.followUpsSent),
  });
}

/**
 * The briefing's title parts: the non-zero counts, in queue order, in the recipient's words, with
 * the plural form of the locale (i18next keys: `<key>_one`, `<key>_other`, or `<key>` alone).
 */
export function briefingTitle(
  strings: Record<string, string>,
  counts: Record<TodayQueueKey, number>,
  locale = 'vi',
): string {
  const plural = new Intl.PluralRules(locale);
  const pick = (k: TodayQueueKey, n: number) => {
    const base = `today.briefing.${k}`;
    return strings[`${base}_${plural.select(n)}`] ?? strings[`${base}_other`] ?? strings[base];
  };
  const parts = TODAY_QUEUES.filter((k) => counts[k] > 0).map((k) =>
    fill(pick(k, counts[k]) ?? '', { count: String(counts[k]) }),
  );
  return fill(strings['today.briefing.title'] ?? '', {
    parts: parts.join(strings['today.briefing.separator'] ?? ', '),
  }).slice(0, 160);
}

/**
 * The morning briefing (spec §6), run by the worker's brain tick once a minute: for each business
 * whose briefing is on, during its local (Asia/Ho_Chi_Minh) `briefing_hour`, once a day, the owner
 * and the admins get Today's counts (in-app + push, to `/app/today`). Counts only, no model call;
 * a recipient whose counts are all zero gets nothing. The counts include the care agent's drafts
 * waiting for approval, and on a local Monday the body adds the 7-day "Rapiz đã mang lại" line
 * (care module, ADR-031), which alone is reason enough to send. Each recipient is notified on their own (one
 * failing does not stop the others) and the day is taken only once every recipient was handled;
 * until then the next tick of the hour tries again, and the per-user dedup key keeps anyone from
 * getting it twice (also when two workers run the same minute).
 */
@Injectable()
export class Briefing {
  readonly #log = new Logger(Briefing.name);

  constructor(
    @Inject(BRAIN_STORE) private readonly store: BrainStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(NOTIFICATION_FACADE) private readonly notifications: NotificationFacade,
    @Inject(TodayQuery) private readonly today: TodayQuery,
    @Inject(TodayExtensions) @Optional() private readonly extensions?: TodayExtensions,
  ) {}

  /** The 7-day impact on a local Monday (null otherwise, without the care module or on error). */
  async #weeklyImpact(ws: WorkspaceId, now: Date): Promise<ImpactResponse | null> {
    const care = this.extensions?.care;
    if (!care || !isHcmMonday(now)) return null;
    try {
      return await care.impact(ws, '7d', now);
    } catch (e) {
      this.#log.warn(`weekly impact of ${ws} not read (${errorClass(e)})`);
      return null;
    }
  }

  /** One pass over every business; returns how many notifications were sent. */
  async pass(now = new Date()): Promise<number> {
    const day = hcmDay(now);
    const hour = hcmHour(now);
    let sent = 0;
    let after: WorkspaceId | null = null;
    for (;;) {
      const ids = await this.workspaces.listActiveIds({ afterId: after, limit: PAGE });
      const states = new Map((await this.store.briefingStates(ids)).map((s) => [s.workspaceId, s]));
      for (const ws of ids) {
        const s = states.get(ws);
        const enabled = s?.briefingEnabled ?? DEFAULT_BRAIN_SETTINGS.briefingEnabled;
        const at = s?.briefingHour ?? DEFAULT_BRAIN_SETTINGS.briefingHour;
        const last = s?.lastBriefingDay ?? null;
        if (!enabled || at !== hour || (last !== null && last >= day)) continue;
        try {
          sent += await this.brief(ws, day, now);
        } catch (e) {
          this.#log.warn(`briefing of ${ws} not sent (${errorClass(e)})`);
        }
      }
      if (ids.length < PAGE) break;
      after = ids[ids.length - 1] ?? null;
    }
    return sent;
  }

  /**
   * Notifies each owner and admin with something to do, then takes the day; returns how many
   * were notified. A recipient that failed leaves the day open for the next tick.
   */
  async brief(ws: WorkspaceId, day: string, now: Date): Promise<number> {
    const accountId = await this.workspaces.accountOf(ws);
    if (!accountId) {
      await this.store.claimBriefing(ws, day);
      return 0;
    }
    const [members, workspace, impact] = await Promise.all([
      this.workspaces.listMembers(ws),
      this.workspaces.getById(ws),
      this.#weeklyImpact(ws, now),
    ]);
    let sent = 0;
    let failed = 0;
    for (const m of members) {
      if (m.status !== 'active' || !ROLES.has(m.role)) continue;
      try {
        const counts = await this.today.counts(ws, { userId: m.userId, viewAll: true }, now);
        const locale = await this.notifications.recipientLocale(m.userId);
        const strings = notificationStrings(locale);
        const weekly = impact ? impactLine(strings, impact, locale) : null;
        if (TODAY_QUEUES.every((k) => counts[k] === 0) && !weekly) continue;
        const body = fill(strings['today.briefing.body'] ?? '', { business: workspace.name });
        const r = await this.notifications.notify({
          accountId,
          userId: m.userId,
          workspaceId: ws,
          type: 'today.briefing',
          params: {
            day,
            ...counts,
            ...(impact && weekly
              ? {
                  impactOrders: impact.ai.orders + impact.aiStaff.orders,
                  impactRevenue: impact.ai.revenue + impact.aiStaff.revenue,
                  impactFollowUps: impact.followUpsSent,
                }
              : {}),
          },
          title: briefingTitle(strings, counts, locale),
          body: (weekly ? `${body}\n${weekly}` : body).slice(0, 4000),
          target: { kind: 'path', path: '/app/today' },
          channels: ['in_app', 'push'],
          dedupKey: `today.briefing:${ws}:${day}`,
        });
        if (!r.deduped) sent++;
      } catch (e) {
        failed++;
        this.#log.warn(`briefing of ${ws} not sent to one recipient (${errorClass(e)})`);
      }
    }
    if (failed === 0) await this.store.claimBriefing(ws, day);
    return sent;
  }
}
