/** Counts of one HQ backfill / reconcile run (codes and counts only, never customer data). */
export interface HqReconcileReport {
  accounts: number;
  /** Accounts linked to a customer by this run (adopted or created). */
  linked: number;
  subscriptionsCreated: number;
  subscriptionsUpdated: number;
  unchanged: number;
  /** Accounts the CRM could not take (no usable phone, email or name). */
  skipped: number;
}

/** Background work of the saas module; run by the `worker` entry and the HQ CLIs. */
export interface SaasRunner {
  /** One pass of the Rapiz HQ sync over new account and billing events. Returns how many it read. */
  tick(): Promise<number>;
  /**
   * Daily jobs, each at most once per day across processes: local trial / renewal reminders of
   * every SaaS business and, from 02:00 (Vietnam time), the nightly HQ reconcile.
   */
  daily(now?: Date): Promise<void>;
  /** Links every platform account to HQ and repairs drifted subscriptions; `dryRun` writes nothing. */
  reconcile(opts: { dryRun: boolean }): Promise<HqReconcileReport>;
}

export const SAAS_RUNNER = Symbol('SAAS_RUNNER');
