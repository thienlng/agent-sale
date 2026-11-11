import { notificationStrings } from '@agent-sales/i18n/notification';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import { NOTIFICATION_FACADE, type NotificationFacade } from '../../notification/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { hcmDay } from '../domain/schedule.js';

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
const short = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The complaint alert (spec §6): when an evaluation newly sets `mood = complaint`, the owner of
 * the business (an active owner member who also owns its account, as the assistant schedule
 * preflight checks) and the conversation's assignee get one in-app + push notification, at most
 * once per conversation per local day (`dedupKey`). Best effort: never fails the evaluation.
 */
@Injectable()
export class ComplaintAlert {
  readonly #log = new Logger(ComplaintAlert.name);

  constructor(
    @Inject(NOTIFICATION_FACADE) private readonly notifications: NotificationFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(ACCOUNT_FACADE) private readonly accounts: AccountFacade,
  ) {}

  async raise(
    ws: WorkspaceId,
    c: {
      conversationId: string;
      customerName: string;
      assigneeId: string | null;
      reason: string | null;
    },
    now: Date,
  ): Promise<number> {
    try {
      const accountId = await this.workspaces.accountOf(ws);
      if (!accountId) return 0;
      const [members, workspace] = await Promise.all([
        this.workspaces.listMembers(ws),
        this.workspaces.getById(ws),
      ]);
      const active = members.filter((m) => m.status === 'active');
      const recipients = new Set<string>();
      for (const m of active.filter((x) => x.role === 'owner')) {
        const owned = await this.accounts.listForUser(m.userId);
        if (owned.some((a) => a.accountId === accountId && a.role === 'owner')) {
          recipients.add(m.userId);
        }
      }
      if (c.assigneeId && active.some((m) => m.userId === c.assigneeId)) {
        recipients.add(c.assigneeId);
      }
      const day = hcmDay(now);
      for (const userId of recipients) {
        const s = notificationStrings(await this.notifications.recipientLocale(userId));
        const vars = {
          customer: short(c.customerName, 80) || '—',
          business: workspace.name,
          reason: short(c.reason ?? '', 200),
        };
        await this.notifications.notify({
          accountId,
          userId,
          workspaceId: ws,
          type: 'brain.complaint',
          params: { conversationId: c.conversationId },
          title: fill(s['brain.complaint.title'] ?? '', vars).slice(0, 160),
          body: fill(s['brain.complaint.body'] ?? '', vars).slice(0, 4000),
          target: { kind: 'conversation', conversationId: c.conversationId },
          channels: ['in_app', 'push'],
          dedupKey: `brain.complaint:${c.conversationId}:${day}`,
        });
      }
      return recipients.size;
    } catch (e) {
      this.#log.warn(
        `complaint alert for conversation ${c.conversationId} not raised (${e instanceof Error ? e.name : 'unknown'})`,
      );
      return 0;
    }
  }
}
