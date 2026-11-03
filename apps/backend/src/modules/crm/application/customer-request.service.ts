import {
  CustomerRequestKind,
  type CustomerRequestDto,
  isRequestIndustry,
  type CustomerRequestList,
  requestDetailsSchema,
  requestProfileFor,
  type RequestSummaryDto,
  unmetRules,
} from '@agent-sales/contracts';
import { isUuid, normalizeAnyPhone, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  type BotRequestResult,
  type RequestsRecorded,
  websiteLeadName,
} from '../api/crm.facade.js';
import { defaultStatusesFor } from '../domain/crm-defaults.js';
import { ContactNotFoundError, RequestsNotOfferedError } from '../domain/crm.errors.js';
import { dateLabel, isPastDate } from '../domain/customer-request.js';
import { ContactService } from './contact.service.js';
import { canSee, type Viewer } from './crm-rules.js';
import { CRM_STORE, type CrmStore, type HistoryRecord } from './ports/crm-store.js';

const DAY_MS = 86_400_000;
/** The customer card shows the latest requests only. */
const CONTACT_REQUESTS_LIMIT = 10;
const OPEN_LIMIT = 10;
const OPEN_WINDOW_MS = 30 * DAY_MS;
const RECENT_WINDOW_MS = 7 * DAY_MS;

/**
 * Customer requests the bot records (ADR-020 generalised to saas, education and spa; ESV spec
 * §5.1): no table of their own, a request is a history entry, a signed note and a status move on
 * the customer found or created by phone.
 */
@Injectable()
export class CustomerRequestService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(ContactService) private readonly contacts: ContactService,
  ) {}

  /** The bot's `record_request`. Bad input answers `invalid`, never throws. */
  async recordFromBot(
    ws: WorkspaceId,
    input: { kind: CustomerRequestKind; details: unknown; preview: boolean },
  ): Promise<BotRequestResult> {
    // 1–2. The industry's profile, and a kind it offers.
    const { industry } = await this.workspaces.getById(ws);
    const profile = requestProfileFor(industry);
    if (!profile || !isRequestIndustry(industry) || !profile.kinds.includes(input.kind))
      return { outcome: 'invalid', problems: ['kind_not_offered'] };
    // 3. Parse.
    const parsed = requestDetailsSchema(industry).safeParse(input.details);
    if (!parsed.success)
      return {
        outcome: 'invalid',
        problems: parsed.error.issues.map((i) =>
          i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
        ),
      };
    const details = parsed.data as Record<string, unknown>;
    // 4. Required groups.
    const unmet = unmetRules(profile.required[input.kind], details);
    if (unmet.length) return { outcome: 'invalid', problems: unmet.map((k) => `missing:${k}`) };
    // 5. Phone.
    const phone = normalizeAnyPhone(String(details['phone'] ?? ''));
    if (!phone) return { outcome: 'invalid', problems: ['phone: not a phone number'] };
    // 6. Past date.
    const date = typeof details['preferredDate'] === 'string' ? details['preferredDate'] : '';
    if (date && isPastDate(date, new Date()))
      return { outcome: 'invalid', problems: ['past_date'] };
    const label = date ? dateLabel(date) : null;
    const missing = unmetRules(profile.recommended[input.kind], details);
    // 7. Preview writes nothing.
    if (input.preview) return { outcome: 'preview', missing, dateLabel: label };
    // 8. The customer by phone (a website placeholder name gives way to the name given).
    const name = String(details['name'] ?? '');
    const { contactId, created } = await this.contacts.upsertLead(ws, {
      phoneE164: phone,
      sourceKey: 'bot',
      displayName: name,
      firstUrl: null,
      renameFrom: websiteLeadName(phone),
    });
    // 9. Status, history entry and note in one transaction.
    const { updated } = await this.contacts.applyBotRequest(ws, contactId, {
      industry,
      profile,
      kind: input.kind,
      details,
      dateLabel: label,
    });
    return {
      outcome: updated ? 'updated' : 'recorded',
      contactId,
      created,
      missing,
      dateLabel: label,
    };
  }

  /** The customer's latest requests, under the visibility of `GET /contacts/{id}`. */
  listForContact(
    ws: WorkspaceId,
    contactId: string,
    viewer?: Viewer,
  ): Promise<CustomerRequestList> {
    return this.store.run(ws, async (tx) => {
      const contact = isUuid(contactId) ? await tx.contacts.find(contactId) : null;
      if (!contact || !canSee(contact, viewer)) throw new ContactNotFoundError(contactId);
      const rows = await tx.history.requestEntries(contactId, CONTACT_REQUESTS_LIMIT);
      return { data: rows.flatMap((r) => toRequestDto(r) ?? []) };
    });
  }

  /**
   * Customers per status, the open requests of the last 30 days (customers still at the kind's
   * target status) and the requests of the last 7 days. NOT_FOUND outside the request industries.
   */
  async summary(ws: WorkspaceId): Promise<RequestSummaryDto> {
    const { industry } = await this.workspaces.getById(ws);
    const profile = requestProfileFor(industry);
    if (!profile) throw new RequestsNotOfferedError();
    const targets = profile.kinds.flatMap((kind) => {
      const move = profile.status[kind];
      return move ? [{ kind, statusKey: move.key }] : [];
    });
    const now = new Date();
    return this.store.run(ws, async (tx) => {
      await tx.options.ensureDefaults(ws, 'status', defaultStatusesFor(industry));
      const [statuses, counts, open, recent] = await Promise.all([
        tx.options.list('status'),
        tx.contacts.countByStatus(),
        tx.history.openRequests({
          since: new Date(now.getTime() - OPEN_WINDOW_MS),
          targets,
          limit: OPEN_LIMIT,
        }),
        tx.history.requestCounts(new Date(now.getTime() - RECENT_WINDOW_MS), now),
      ]);
      const countOf = new Map(counts.map((c) => [c.statusId, c.count]));
      return {
        statuses: statuses
          .filter((s) => !s.archivedAt)
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            statusId: s.id,
            key: s.key,
            name: s.name,
            color: s.color,
            count: countOf.get(s.id) ?? 0,
          })),
        open: open.flatMap((r) => {
          const dto = toRequestDto(r);
          return dto ? [{ ...dto, contactName: r.contactName, statusKey: r.statusKey }] : [];
        }),
        recorded7d: recent.reduce((sum, r) => sum + r.count, 0),
      };
    });
  }

  /** New requests (`contact.request_recorded`) in `[since, until)`: counts only. */
  recorded(ws: WorkspaceId, q: { since: Date; until: Date }): Promise<RequestsRecorded> {
    return this.store.run(ws, async (tx) => {
      const rows = await tx.history.requestCounts(q.since, q.until);
      const byKind = new Map<CustomerRequestKind, number>();
      const byStatus = new Map<string, { key: string | null; name: string; count: number }>();
      let count = 0;
      for (const r of rows) {
        const kind = CustomerRequestKind.safeParse(r.kind);
        if (!kind.success) continue;
        count += r.count;
        byKind.set(kind.data, (byKind.get(kind.data) ?? 0) + r.count);
        const name = r.statusName ?? '';
        const id = `${r.statusKey ?? ''}\u0000${name}`;
        const s = byStatus.get(id) ?? { key: r.statusKey, name, count: 0 };
        s.count += r.count;
        byStatus.set(id, s);
      }
      const desc = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
      return {
        count,
        byKind: [...byKind].map(([kind, n]) => ({ kind, count: n })).sort(desc),
        byStatus: [...byStatus.values()].sort(desc),
      };
    });
  }
}

/** A history entry as a request; null for an entry whose data is not one (never written so). */
function toRequestDto(r: HistoryRecord): CustomerRequestDto | null {
  const kind = CustomerRequestKind.safeParse(r.data['kind']);
  if (!kind.success) return null;
  const raw = r.data['details'];
  const details: Record<string, string> = {};
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw as Record<string, unknown>))
      if (typeof v === 'string' && k !== 'phone' && k !== 'email') details[k] = v;
  const label = r.data['dateLabel'];
  return {
    id: r.id,
    contactId: r.contactId,
    kind: kind.data,
    update: r.type === 'contact.request_updated',
    details,
    dateLabel: typeof label === 'string' ? label : null,
    recordedAt: r.createdAt.toISOString(),
  };
}
