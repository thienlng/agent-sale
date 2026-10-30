-- SaaS vertical (ADR-014): one subscription per customer; requests live on the customer record.
CREATE TABLE saas_subscriptions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  contact_id uuid NOT NULL,
  plan_name text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('trial','active','past_due','canceled')),
  billing_period text NOT NULL CHECK (billing_period IN ('monthly','quarterly','yearly')),
  mrr bigint NOT NULL DEFAULT 0 CHECK (mrr >= 0),
  seats integer CHECK (seats IS NULL OR seats > 0),
  trial_ends_on date, started_on date, renews_on date, canceled_on date,
  external_ref text, note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_subscriptions_trial_end CHECK (stage <> 'trial' OR trial_ends_on IS NOT NULL),
  CONSTRAINT saas_subscriptions_canceled_on CHECK (stage <> 'canceled' OR canceled_on IS NOT NULL),
  CONSTRAINT saas_subscriptions_contact_unique UNIQUE (workspace_id, contact_id),
  CONSTRAINT saas_subscriptions_contact_fk FOREIGN KEY (workspace_id, contact_id)
    REFERENCES contacts(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX saas_subscriptions_stage_idx ON saas_subscriptions(workspace_id, stage);
CREATE UNIQUE INDEX saas_subscriptions_external_ref_unique ON saas_subscriptions(workspace_id, external_ref)
  WHERE external_ref IS NOT NULL;

ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY saas_subscriptions_tenant ON saas_subscriptions FOR ALL TO app_tenant
  USING (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid))
  WITH CHECK (workspace_id = (SELECT nullif(current_setting('app.workspace_id', true), '')::uuid));
CREATE POLICY saas_subscriptions_system ON saas_subscriptions FOR ALL TO app_system USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON saas_subscriptions TO app_tenant, app_system;
