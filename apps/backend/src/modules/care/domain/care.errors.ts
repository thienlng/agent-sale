import { DomainError } from '@agent-sales/shared';

/** The care message does not exist in this workspace or the viewer may not see it. */
export class CareMessageNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Care message not found', { id });
  }
}

/** The draft was already decided (sent, rejected, expired) by someone else. */
export class CareMessageNotPendingError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(id: string, status: string) {
    super('This draft is no longer waiting for approval', { id, status });
  }
}

/** The 24-hour window closed (or the conversation changed): the draft cannot be sent. */
export class CareWindowClosedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(id: string) {
    super('The messaging window is closed; the draft expired', { id });
  }
}

/** Unknown follow-up template. */
export class CareTemplateNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(key: string) {
    super('Template not found', { key });
  }
}
