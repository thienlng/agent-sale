import { DomainError } from '@agent-sales/shared';

import type { StopReason } from './care.js';

/*
 * Approval refusals carry a module code: the HTTP layer answers 409 CONFLICT with the code in
 * `details.reason` (`CARE_DRAFT_DECIDED`, `CARE_WINDOW_CLOSED`, `CARE_TAKEN_OVER`,
 * `CARE_CUSTOMER_REPLIED`, `CARE_STOPPED`, `CARE_LIMIT_REACHED`), so the web can tell them apart.
 */

/** The care message does not exist in this workspace or the viewer may not see it. */
export class CareMessageNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Care message not found', { id });
  }
}

/** The draft was already decided (sent, scheduled, rejected, expired) by someone else. */
export class CareMessageNotPendingError extends DomainError {
  readonly code = 'CARE_DRAFT_DECIDED';
  constructor(id: string, status: string) {
    super('This draft is no longer waiting for approval', { id, status });
  }
}

/** The 24-hour window closed (or closes before the message could go out): the draft expired. */
export class CareWindowClosedError extends DomainError {
  readonly code = 'CARE_WINDOW_CLOSED';
  constructor(id: string) {
    super('The messaging window is closed; the draft expired', { id });
  }
}

/** A person holds the conversation (hand-off or takeover): the draft expired (ADR-031 §7). */
export class CareTakenOverError extends DomainError {
  readonly code = 'CARE_TAKEN_OVER';
  constructor(id: string) {
    super('A person holds this conversation; the draft expired', { id });
  }
}

/** The customer wrote after the draft was written: it no longer fits, so it expired. */
export class CareCustomerRepliedError extends DomainError {
  readonly code = 'CARE_CUSTOMER_REPLIED';
  constructor(id: string) {
    super('The customer wrote after this draft; it expired', { id });
  }
}

/** Another stop rule applies now (closed, opted out, ordered, stage moved, …): it expired. */
export class CareStoppedError extends DomainError {
  readonly code = 'CARE_STOPPED';
  constructor(id: string, stopReason: StopReason) {
    super('This follow-up no longer applies; the draft expired', { id, stopReason });
  }
}

/** Two agent messages went to this customer in the last 24 hours; the draft stays to retry. */
export class CareLimitReachedError extends DomainError {
  readonly code = 'CARE_LIMIT_REACHED';
  constructor(id: string, allowedAt: Date) {
    super('This customer got two follow-ups in the last 24 hours', {
      id,
      allowedAt: allowedAt.toISOString(),
    });
  }
}

/** Unknown follow-up template. */
export class CareTemplateNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(key: string) {
    super('Template not found', { key });
  }
}
