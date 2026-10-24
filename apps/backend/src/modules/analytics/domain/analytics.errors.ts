import type { QueryIssue } from '@agent-sales/contracts';
import { DomainError } from '@agent-sales/shared';

/** The query asks for something the definitions do not allow; `issues` says what, so the UI can explain. */
export class InvalidAnalyticsQueryError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(issues: readonly QueryIssue[]) {
    super('The statistics query is not valid', { issues });
  }
}
