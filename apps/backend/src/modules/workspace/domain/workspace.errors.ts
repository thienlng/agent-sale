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

/** The plan has no free seat for another active member (docs/08 `members.max`). */
export class SeatLimitError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  constructor(limit: number, used: number) {
    super('The plan has no free member seat', { key: 'members.max', limit, used });
  }
}

/** Someone saved the profile since it was loaded. */
export class ProfileStaleError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(version: number) {
    super('The profile was changed by someone else; reload and try again', { version });
  }
}

/** The uploaded logo breaks a rule; `reason` says which, the rest describes the limits. */
export class LogoRejectedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: string, extra: Record<string, unknown> = {}) {
    super('This logo cannot be used', { field: 'logo', reason, ...extra });
  }
}

export class LogoNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('This workspace has no logo');
  }
}
