import { DomainError } from '@agent-sales/shared';

export class InvalidWorkspaceError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

export class WorkspaceNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Workspace not found', { id });
  }
}

/** The owner's membership cannot be removed or given another role. */
export class OwnerMembershipError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The owner cannot be removed or given another role');
  }
}

export class MemberNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(userId: string) {
    super('Member not found', { userId });
  }
}
