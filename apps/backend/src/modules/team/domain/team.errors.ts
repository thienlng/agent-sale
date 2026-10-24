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

/** No free seat for another invitation (active members plus waiting invitations fill the plan). */
export class SeatLimitReachedError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  constructor(limit: number, members: number, pending: number) {
    super('The plan has no free member seat', { key: 'members.max', limit, members, pending });
  }
}

/** The member owns customers: say where they go (another member, or unassigned). */
export class ReassignmentRequiredError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(owned: { sales: number; care: number }) {
    super('This member owns customers: choose who takes them over', {
      reassignmentRequired: true,
      ...owned,
    });
  }
}

export class InvalidReassignmentError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Customers can only go to another active owner, admin, Sales or CSKH member');
  }
}
