import type { ExportTable, WorkspaceExportSource } from '@agent-sales/contracts';
import { exportTable, type Database } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';

/**
 * The saas module's part of the workspace data export (SET-10): customer subscriptions, the plan
 * catalog and the subscription change history. `customer_id` joins with crm's `customers.csv`
 * (crm's tables are not read here). Reminder bookkeeping and versions are left out.
 */
export class SaasExportSource implements WorkspaceExportSource {
  constructor(private readonly db: Database | null) {}

  exportTables(ws: string): readonly ExportTable[] {
    const db = this.db;
    if (!db) return [];
    const id = workspaceId(ws);
    return [
      exportTable(db, id, {
        file: 'saas_subscriptions.csv',
        table: 'saas_subscriptions',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'plan_id', sql: 't.plan_id' },
          { header: 'plan', sql: 't.plan_name' },
          { header: 'stage', sql: 't.stage' },
          { header: 'billing_period', sql: 't.billing_period' },
          { header: 'mrr', sql: 't.mrr' },
          { header: 'seats', sql: 't.seats' },
          { header: 'trial_ends_on', sql: 't.trial_ends_on::text' },
          { header: 'started_on', sql: 't.started_on::text' },
          { header: 'renews_on', sql: 't.renews_on::text' },
          { header: 'canceled_on', sql: 't.canceled_on::text' },
          { header: 'churn_reason', sql: 't.churn_reason' },
          { header: 'churn_note', sql: 't.churn_note' },
          { header: 'usage_used', sql: 't.usage_used' },
          { header: 'usage_limit', sql: 't.usage_limit' },
          { header: 'usage_at', sql: 't.usage_at', time: true },
          { header: 'external_source', sql: 't.external_source' },
          { header: 'external_ref', sql: 't.external_ref' },
          { header: 'note', sql: 't.note' },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'saas_plans.csv',
        table: 'saas_plans',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'name', sql: 't.name' },
          { header: 'prices', sql: 't.prices' },
          { header: 'position', sql: 't.position' },
          { header: 'archived_at', sql: 't.archived_at', time: true },
          { header: 'created_at', sql: 't.created_at', time: true },
          { header: 'updated_at', sql: 't.updated_at', time: true },
        ],
      }),
      exportTable(db, id, {
        file: 'saas_subscription_history.csv',
        table: 'saas_subscription_history',
        columns: [
          { header: 'id', sql: 't.id' },
          { header: 'subscription_id', sql: 't.subscription_id' },
          { header: 'customer_id', sql: 't.contact_id' },
          { header: 'from_stage', sql: 't.from_stage' },
          { header: 'to_stage', sql: 't.to_stage' },
          { header: 'from_plan', sql: 't.from_plan' },
          { header: 'to_plan', sql: 't.to_plan' },
          { header: 'from_mrr', sql: 't.from_mrr' },
          { header: 'to_mrr', sql: 't.to_mrr' },
          { header: 'churn_reason', sql: 't.churn_reason' },
          { header: 'source', sql: 't.source' },
          { header: 'actor_user_id', sql: 't.actor_user_id' },
          { header: 'changed_at', sql: 't.changed_at', time: true },
        ],
      }),
    ];
  }
}
