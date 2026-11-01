/** Deployment settings of the integration module (bound from env in integration.module.ts). */
export interface IntegrationOptions {
  /**
   * Public HTTPS origin of the webhook ingress (`apps/webhook`). Unset: webhooks are not
   * registered and the periodic reconcile alone keeps the catalog fresh.
   */
  webhookBaseUrl: string | undefined;
}

export const INTEGRATION_OPTIONS = Symbol('INTEGRATION_OPTIONS');
