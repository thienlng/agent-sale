import { localDate } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { HqReconcileReport, SaasRunner } from '../api/saas.runner.js';
import { HqSyncHandler } from './event-handlers/hq-sync.handler.js';
import { HqContext } from './hq-context.js';
import { HqReconcileService } from './hq-reconcile.service.js';
import { SAAS_SYSTEM_STORE, type SaasSystemStore } from './ports/saas-system-store.js';
import { REMINDER_TIMEZONE, SaasReminderService } from './saas-reminder.service.js';

/** The nightly reconcile runs from this local hour on (quiet hours). */
const RECONCILE_FROM_HOUR = 2;

const hourIn = (at: Date, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at),
  );

@Injectable()
export class SaasRunnerImpl implements SaasRunner {
  constructor(
    @Inject(HqSyncHandler) private readonly sync: HqSyncHandler,
    @Inject(HqReconcileService) private readonly reconciler: HqReconcileService,
    @Inject(SaasReminderService) private readonly reminders: SaasReminderService,
    @Inject(HqContext) private readonly hq: HqContext,
    @Inject(SAAS_SYSTEM_STORE) private readonly system: SaasSystemStore,
  ) {}

  tick(): Promise<number> {
    return this.sync.tick();
  }

  async daily(now = new Date()): Promise<void> {
    const today = localDate(now, REMINDER_TIMEZONE);
    if (await this.system.claimDaily('saas.reminders', today)) await this.reminders.run(now);
    if (
      this.hq.configured &&
      hourIn(now, REMINDER_TIMEZONE) >= RECONCILE_FROM_HOUR &&
      (await this.system.claimDaily('saas.hq_reconcile', today))
    )
      await this.reconciler.run({ dryRun: false });
  }

  reconcile(opts: { dryRun: boolean }): Promise<HqReconcileReport> {
    return this.reconciler.run(opts);
  }
}
