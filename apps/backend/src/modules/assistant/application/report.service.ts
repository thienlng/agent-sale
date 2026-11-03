import { Inject, Injectable } from '@nestjs/common';

import type { ReportPeriod, ReportWindow } from '../domain/report-period.js';
import { resolvePeriod } from '../domain/report-period.js';
import { type PeriodRef, renderReport, type ReportResult } from '../domain/report-render.js';
import {
  REPORT_DATA_SOURCE,
  REPORT_STRINGS,
  type ReportDataSource,
  type ReportStringsSource,
} from '../domain/ports/report-data-source.port.js';
import type { ScheduleMode, ScheduleTemplate } from '../domain/schedule.js';

/** What a report needs from its schedule. */
export interface ReportSpec {
  businessId: string;
  template: ScheduleTemplate;
  mode: ScheduleMode;
  /** Validated for the template (defaults filled). */
  params: Record<string, unknown>;
  /** `new_orders` and `new_requests` alerts: what arrived at or after it is new. */
  alertCursor?: Date | null;
}

export interface ComputedReport {
  result: ReportResult;
  /** Whether an alert's condition holds (always true for a report). */
  hit: boolean;
  /** What an alert fingerprints (variant or conversation ids); never stored or delivered. */
  hitIds: string[];
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
/** Industries that convert through requests rather than orders (the assistant's `service` group). */
const SERVICE_INDUSTRIES: ReadonlySet<string> = new Set(['education', 'spa']);

/**
 * Computes a schedule's report in code through `ReportDataSource` (S3-R1, S3-R2) and renders it
 * in the recipient's language (S3-R6). Used by the schedule runner and the preview.
 */
@Injectable()
export class ReportService {
  constructor(
    @Inject(REPORT_DATA_SOURCE) private readonly data: ReportDataSource,
    @Inject(REPORT_STRINGS) private readonly strings: ReportStringsSource,
  ) {}

  /** `periodAt` resolves the report period (a cadence slot's time); `now` bounds alert reads. */
  async compute(s: ReportSpec, now: Date, periodAt: Date = now): Promise<ComputedReport> {
    const ws = s.businessId;
    const period = (): PeriodRef & { since: Date; until: Date } => {
      const p = (s.params['period'] ?? 'day') as ReportPeriod;
      const w = (s.params['window'] ?? 'previous') as ReportWindow;
      return { period: p, window: w, ...resolvePeriod(p, w, periodAt) };
    };
    const ref = ({ period: p, window: w, from, to }: PeriodRef): PeriodRef => ({
      period: p,
      window: w,
      from,
      to,
    });
    switch (s.template) {
      case 'revenue_summary': {
        const p = period();
        const [figures, industry] = await Promise.all([
          this.data.revenue(ws, p.from, p.to),
          this.data.industry(ws),
        ]);
        // A hotel's revenue is its stays (QA Villas #6); an education or spa business converts
        // through requests, so their count follows the order figures (T-187).
        const stays = industry === 'hotel' ? await this.data.stays(ws, p.from, p.to) : undefined;
        const requests = SERVICE_INDUSTRIES.has(industry)
          ? { count: (await this.data.requests(ws, p.since, p.until)).count }
          : undefined;
        return {
          result: {
            template: 'revenue_summary',
            mode: 'report',
            period: ref(p),
            figures,
            ...(stays ? { stays } : {}),
            ...(requests ? { requests } : {}),
          },
          hit: true,
          hitIds: [],
        };
      }
      case 'new_orders': {
        if (s.mode === 'alert') {
          const since = s.alertCursor ?? now;
          const o = await this.data.orders(ws, since, now);
          return {
            result: {
              template: 'new_orders',
              mode: 'alert',
              period: null,
              figures: {
                count: o.count,
                total: o.total,
                latest: o.latest.map(({ code, total }) => ({ code, total })),
              },
            },
            hit: o.count >= num(s.params['minCount'], 1),
            hitIds: [],
          };
        }
        const p = period();
        const o = await this.data.orders(ws, p.since, p.until);
        return {
          result: {
            template: 'new_orders',
            mode: 'report',
            period: ref(p),
            figures: {
              count: o.count,
              total: o.total,
              latest: o.latest.map(({ code, total }) => ({ code, total })),
            },
          },
          hit: true,
          hitIds: [],
        };
      }
      case 'new_requests': {
        const alert = s.mode === 'alert';
        const p = alert ? null : period();
        const [r, industry] = await Promise.all([
          this.data.requests(ws, p ? p.since : (s.alertCursor ?? now), p ? p.until : now),
          this.data.industry(ws),
        ]);
        return {
          result: {
            template: 'new_requests',
            mode: alert ? 'alert' : 'report',
            period: p ? ref(p) : null,
            industry,
            figures: {
              count: r.count,
              byKind: r.byKind,
              byStatus: r.byStatus.map(({ key, name, count }) => ({ key, label: name, count })),
            },
          },
          hit: !alert || r.count >= num(s.params['minCount'], 1),
          hitIds: [],
        };
      }
      case 'low_stock': {
        const threshold = num(s.params['threshold'], 5);
        const st = await this.data.lowStock(ws, threshold);
        return {
          result: {
            template: 'low_stock',
            mode: s.mode,
            threshold,
            figures: { count: st.count, items: st.items },
          },
          hit: s.mode === 'report' || st.count > 0,
          hitIds: st.ids,
        };
      }
      case 'unanswered_conversations': {
        const minutes = num(s.params['minutes'], 30);
        const a = await this.data.awaiting(ws, new Date(now.getTime() - minutes * 60_000));
        const oldestMinutes = a.oldestSince
          ? Math.max(0, Math.floor((now.getTime() - Date.parse(a.oldestSince)) / 60_000))
          : null;
        return {
          result: {
            template: 'unanswered_conversations',
            mode: s.mode,
            minutes,
            figures: { count: a.count, oldestMinutes, byChannel: a.byChannel },
          },
          hit: s.mode === 'report' || a.count >= num(s.params['minCount'], 1),
          hitIds: a.ids,
        };
      }
      case 'new_customers': {
        const p = period();
        const c = await this.data.newContacts(ws, p.since, p.until);
        return {
          result: { template: 'new_customers', mode: 'report', period: ref(p), figures: c },
          hit: true,
          hitIds: [],
        };
      }
    }
  }

  render(
    result: ReportResult,
    locale: 'vi' | 'en',
    businessName: string,
  ): { title: string; body: string } {
    const { title, body } = renderReport(result, this.strings(locale), businessName);
    // The notification limits (160 / 4 000 chars).
    return {
      title: title.length > 160 ? `${title.slice(0, 159)}…` : title,
      body: body.length > 4000 ? `${body.slice(0, 3999)}…` : body,
    };
  }

  /** A translated text of the `notification` catalog (runner notices). */
  text(locale: 'vi' | 'en', key: string): string {
    return this.strings(locale)[key] ?? key;
  }
}
