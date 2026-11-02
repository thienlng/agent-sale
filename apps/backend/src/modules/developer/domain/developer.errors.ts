import { DomainError } from '@agent-sales/shared';

export class WebhookEndpointNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Webhook endpoint not found');
  }
}

export class WebhookDeliveryNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Webhook delivery not found');
  }
}

/** Someone changed the endpoint since it was read (optimistic `version`). */
export class WebhookEndpointStaleError extends DomainError {
  readonly code = 'STALE_VERSION';
  constructor() {
    super('The webhook endpoint was changed by someone else; reload it');
  }
}

/** The URL is not a deliverable public HTTPS address (ADR-022 §6); `reason` names the rule. */
export class WebhookUrlRejectedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: string) {
    super('This URL cannot receive webhooks', { reason });
  }
}

export class WebhookEndpointLimitError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  constructor(max: number) {
    super('Too many webhook endpoints', { max });
  }
}

/** The plan of the workspace does not include the public API (ADR-022 §4). */
export class PublicApiLockedError extends DomainError {
  readonly code = 'FEATURE_LOCKED';
  constructor() {
    super('The public API is not included in this plan', { feature: 'feature.public_api' });
  }
}
