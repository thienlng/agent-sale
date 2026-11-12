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

/** Deleting and restoring a business is for its owner only (ADR-033). */
export class NotBusinessOwnerError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('Only the owner can delete or restore this business', { reason: 'owner_only' });
  }
}

/** The typed confirmation is not the business name. */
export class BusinessNameMismatchError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Type the business name exactly to delete it', {
      field: 'confirmName',
      reason: 'name_mismatch',
    });
  }
}

/** Only an active business can be deleted (it is already deleted or not in service). */
export class BusinessNotActiveError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(status: string) {
    super('This business cannot be deleted now', { reason: 'not_active', status });
  }
}

/** Restore asked for a business that is not waiting for its purge. */
export class BusinessNotDeletedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This business is not deleted', { reason: 'not_deleted' });
  }
}

/** The 30-day restore window ended; the purge removes (or removed) the data. */
export class RestoreWindowClosedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The restore window of this business has ended', { reason: 'restore_window_closed' });
  }
}

export class LogoNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('This workspace has no logo');
  }
}
