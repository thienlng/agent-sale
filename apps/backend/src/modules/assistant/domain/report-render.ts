import type { ReportPeriod, ReportWindow } from './report-period.js';

/**
 * A computed report (T-172): the template, its period or condition and the figures. It is
 * stored on the run (≤ 16 KB) and rendered for the bell and the email. By S3-R9 it carries
 * counts, money, order codes, product names and SKUs, waiting times and channel names, never
 * customer names, phones, emails or message text, and never the ids an alert fingerprints.
 */
export interface PeriodRef {
  period: ReportPeriod;
  window: ReportWindow;
  /** Local dates (yyyy-mm-dd), inclusive. */
  from: string;
  to: string;
}

export type ReportResult =
  | {
      template: 'revenue_summary';
      mode: 'report';
      period: PeriodRef;
      figures: {
        sales: number;
        revenue: number;
        closedOrders: number;
        averageOrderValue: number;
        profit: number;
      };
      /** A hotel's stays checking in during the period (QA Villas #6); absent for a shop. */
      stays?: { bookings: number; nights: number; revenue: number; profit: number };
      /** An education or spa business's new requests of the period (T-187); absent otherwise. */
      requests?: { count: number };
    }
  | {
      template: 'new_orders';
      mode: 'report' | 'alert';
      /** Reports only; an alert covers the orders since its last check. */
      period: PeriodRef | null;
      figures: { count: number; total: number; latest: { code: string; total: number }[] };
    }
  | {
      template: 'low_stock';
      mode: 'report' | 'alert';
      threshold: number;
      figures: {
        count: number;
        items: { product: string; sku: string | null; available: number }[];
      };
    }
  | {
      template: 'unanswered_conversations';
      mode: 'report' | 'alert';
      minutes: number;
      figures: {
        count: number;
        /** Minutes the longest-waiting conversation has waited; null when none waits. */
        oldestMinutes: number | null;
        byChannel: { channel: string; count: number }[];
      };
    }
  | {
      template: 'new_customers';
      mode: 'report';
      period: PeriodRef;
      figures: { count: number; bySource: { source: string | null; count: number }[] };
    }
  | {
      template: 'new_requests';
      mode: 'report' | 'alert';
      /** Reports only; an alert covers the requests since its last check. */
      period: PeriodRef | null;
      /** The business's industry: it picks the kind labels (a saas `trial` is "dùng thử"). */
      industry: string;
      figures: {
        count: number;
        byKind: { kind: string; count: number }[];
        /** By the customer's current status; `label` is the business's own status name. */
        byStatus: { key: string | null; label: string; count: number }[];
      };
    };

/** Flat `a.b.c` keys of the `notification` catalog, with `{{var}}` placeholders. */
export type ReportStrings = Record<string, string>;

/** Low-stock lines listed in a report; the rest is summarised. */
export const LOW_STOCK_LINES = 10;

/** Vietnamese grouping: 1250000 → '1.250.000'. */
export function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1250000 → '1.250.000 ₫'. */
export function formatVnd(n: number): string {
  return `${formatNumber(n)} ₫`;
}

/** yyyy-mm-dd → dd/mm. */
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Fills `{{var}}`; a missing key renders as the key itself, so a gap is visible, not silent. */
export function fill(
  strings: ReportStrings,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  const template = strings[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    vars[name] === undefined ? `{{${name}}}` : String(vars[name]),
  );
}

function periodText(strings: ReportStrings, p: PeriodRef): string {
  return fill(strings, `period.${p.period}_${p.window}`, {
    from: shortDate(p.from),
    to: shortDate(p.to),
  });
}

const channelName = (strings: ReportStrings, channel: string) =>
  strings[`channel.${channel}`] ?? strings['channel.unknown'] ?? channel;

/** A request kind in words: the industry's own label first (`kind.saas.trial`), then the kind's. */
const kindLabel = (strings: ReportStrings, industry: string, kind: string) =>
  strings[`report.new_requests.kind.${industry}.${kind}`] ??
  strings[`report.new_requests.kind.${kind}`] ??
  kind;

/** The title and the plain-text body of a report in the strings' language. */
export function renderReport(
  r: ReportResult,
  strings: ReportStrings,
  businessName: string,
): { title: string; body: string } {
  const business = businessName;
  switch (r.template) {
    case 'revenue_summary': {
      const f = r.figures;
      const orders = fill(strings, 'report.revenue_summary.body', {
        sales: formatVnd(f.sales),
        revenue: formatVnd(f.revenue),
        closedOrders: formatNumber(f.closedOrders),
        averageOrderValue: formatVnd(f.averageOrderValue),
        profit: formatVnd(f.profit),
      });
      const period = periodText(strings, r.period);
      if (!r.stays) {
        const requests = r.requests
          ? fill(strings, 'report.revenue_summary.requests_line', {
              count: formatNumber(r.requests.count),
            })
          : '';
        return {
          title: fill(strings, 'report.revenue_summary.title', { period, business }),
          body: requests ? `${orders}\n\n${requests}` : orders,
        };
      }
      // A hotel sells stays: those lead, and orders follow only when it has any.
      const stays = fill(strings, 'report.revenue_summary.stays_body', {
        revenue: formatVnd(r.stays.revenue),
        nights: formatNumber(r.stays.nights),
        bookings: formatNumber(r.stays.bookings),
        profit: formatVnd(r.stays.profit),
      });
      return {
        title: fill(strings, 'report.revenue_summary.stays_title', { period, business }),
        body: f.sales > 0 || f.closedOrders > 0 ? `${stays}\n\n${orders}` : stays,
      };
    }
    case 'new_orders': {
      const f = r.figures;
      const title =
        r.mode === 'alert' || !r.period
          ? fill(strings, 'alert.new_orders.title', { count: formatNumber(f.count), business })
          : fill(strings, 'report.new_orders.title', {
              period: periodText(strings, r.period),
              business,
            });
      if (f.count === 0) return { title, body: fill(strings, 'report.new_orders.none') };
      const lines = [
        fill(strings, 'report.new_orders.body', {
          count: formatNumber(f.count),
          total: formatVnd(f.total),
        }),
      ];
      if (f.latest.length) {
        lines.push('', fill(strings, 'report.new_orders.latest'));
        for (const o of f.latest) {
          lines.push(
            fill(strings, 'report.new_orders.item', { code: o.code, total: formatVnd(o.total) }),
          );
        }
      }
      return { title, body: lines.join('\n') };
    }
    case 'low_stock': {
      const f = r.figures;
      const title =
        r.mode === 'alert'
          ? fill(strings, 'alert.low_stock.title', { count: formatNumber(f.count), business })
          : fill(strings, 'report.low_stock.title', { business });
      const threshold = formatNumber(r.threshold);
      if (f.count === 0)
        return { title, body: fill(strings, 'report.low_stock.none', { threshold }) };
      const lines = [
        fill(strings, 'report.low_stock.body', { count: formatNumber(f.count), threshold }),
      ];
      for (const x of f.items.slice(0, LOW_STOCK_LINES)) {
        lines.push(
          fill(strings, 'report.low_stock.item', {
            product: x.product,
            sku: x.sku ? fill(strings, 'report.low_stock.sku', { sku: x.sku }) : '',
            available: formatNumber(x.available),
          }),
        );
      }
      const shown = Math.min(f.items.length, LOW_STOCK_LINES);
      if (f.count > shown) {
        lines.push(
          fill(strings, 'report.low_stock.more', { count: formatNumber(f.count - shown) }),
        );
      }
      return { title, body: lines.join('\n') };
    }
    case 'unanswered_conversations': {
      const f = r.figures;
      const title =
        r.mode === 'alert'
          ? fill(strings, 'alert.unanswered_conversations.title', {
              count: formatNumber(f.count),
              business,
            })
          : fill(strings, 'report.unanswered_conversations.title', { business });
      if (f.count === 0) {
        return {
          title,
          body: fill(strings, 'report.unanswered_conversations.none', { minutes: r.minutes }),
        };
      }
      const lines = [
        fill(strings, 'report.unanswered_conversations.body', {
          count: formatNumber(f.count),
          minutes: formatNumber(r.minutes),
          oldest: formatNumber(f.oldestMinutes ?? r.minutes),
        }),
      ];
      for (const c of f.byChannel) {
        lines.push(
          fill(strings, 'report.unanswered_conversations.channel', {
            channel: channelName(strings, c.channel),
            count: formatNumber(c.count),
          }),
        );
      }
      return { title, body: lines.join('\n') };
    }
    case 'new_requests': {
      const f = r.figures;
      const title =
        r.mode === 'alert' || !r.period
          ? fill(strings, 'alert.new_requests.title', { count: formatNumber(f.count), business })
          : fill(strings, 'report.new_requests.title', {
              period: periodText(strings, r.period),
              business,
            });
      if (f.count === 0) return { title, body: fill(strings, 'report.new_requests.none') };
      const lines = [fill(strings, 'report.new_requests.body', { count: formatNumber(f.count) })];
      if (f.byKind.length) {
        lines.push('', fill(strings, 'report.new_requests.byKind'));
        for (const k of f.byKind) {
          lines.push(
            fill(strings, 'report.new_requests.item', {
              label: kindLabel(strings, r.industry, k.kind),
              count: formatNumber(k.count),
            }),
          );
        }
      }
      if (f.byStatus.length) {
        lines.push('', fill(strings, 'report.new_requests.byStatus'));
        for (const st of f.byStatus) {
          lines.push(
            fill(strings, 'report.new_requests.item', {
              label: st.label,
              count: formatNumber(st.count),
            }),
          );
        }
      }
      return { title, body: lines.join('\n') };
    }
    case 'new_customers': {
      const f = r.figures;
      const lines = [fill(strings, 'report.new_customers.body', { count: formatNumber(f.count) })];
      for (const s of f.bySource) {
        lines.push(
          fill(strings, 'report.new_customers.source', {
            source: s.source ?? fill(strings, 'report.new_customers.noSource'),
            count: formatNumber(s.count),
          }),
        );
      }
      return {
        title: fill(strings, 'report.new_customers.title', {
          period: periodText(strings, r.period),
          business,
        }),
        body: lines.join('\n'),
      };
    }
  }
}
