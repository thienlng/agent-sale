import { localDate } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { LOCAL_REMINDER_DAYS, reminderNote, SYNC_AUTHOR } from '../domain/hq-mapping.js';
import { addDays } from '../domain/saas-lead.js';
import { daysBetween } from '../domain/subscription-rules.js';
import { SAAS_SYSTEM_STORE, type SaasSystemStore } from './ports/saas-system-store.js';

/** Platform calendar for the daily scan (most businesses are in Vietnam; ±1 day is harmless). */
export const REMINDER_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Trial-ending (3 days ahead) and renewal (7 days ahead) follow-ups for every SaaS business's own
 * customers (spec §6.5). The CRM has no tasks yet, so a follow-up is a note on the customer; each
 * (kind, date) once per subscription. Rows linked by the Rapiz HQ sync are left out: the platform
 * sends their reminders as events.
 */
@Injectable()
export class SaasReminderService {
  readonly #log = new Logger(SaasReminderService.name);

  constructor(
    @Inject(SAAS_SYSTEM_STORE) private readonly system: SaasSystemStore,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}

  /** Returns how many follow-ups it added. */
  async run(now = new Date()): Promise<number> {
    const today = localDate(now, REMINDER_TIMEZONE);
    const due = await this.system.dueReminders({
      trial_ending: { from: today, to: addDays(today, LOCAL_REMINDER_DAYS.trial_ending) },
      renewal_due: { from: today, to: addDays(today, LOCAL_REMINDER_DAYS.renewal_due) },
    });
    let added = 0;
    for (const r of due) {
      const key = `${r.kind}:${r.dueOn}`;
      if (r.remindersSent[key]) continue;
      const note = reminderNote(r.kind, r.dueOn, daysBetween(today, r.dueOn));
      await this.crm.addContactNote(r.workspaceId, r.contactId, note, SYNC_AUTHOR);
      await this.system.markReminderSent(r.workspaceId, r.contactId, key, now);
      added++;
    }
    if (added) this.#log.log(`saas reminders: ${added} follow-ups`);
    return added;
  }
}
