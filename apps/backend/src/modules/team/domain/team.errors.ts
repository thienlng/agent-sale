import { DomainError } from '@agent-sales/shared';

/** Unknown, revoked, expired or already used links all look the same to the caller. */
export class InvitationNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Invitation not found');
  }
}

export class InvitationUnusableError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(status: string) {
    super('This invitation can no longer be used', { status });
  }
}

/** The link was sent to another email than the signed-in user's. */
export class InvitationEmailMismatchError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('This invitation was sent to another email address');
  }
}

export class AlreadyMemberError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This person is already a member');
  }
}

/** Admins manage sales, CSKH and analysts; only the owner manages admins. */
export class AdminOnlyByOwnerError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('Only the owner can invite, change or remove admins');
  }
}

export class TeamUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor() {
    super('Members need a database (DATABASE_URL is not configured)');
  }
}
