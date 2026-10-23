import { DomainError } from '@agent-sales/shared';

export class EmailTakenError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('An account with this email already exists');
  }
}

/** Same message for unknown email and wrong password (no account enumeration). */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor() {
    super('Invalid email or password');
  }
}

export class WeakPasswordError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

/** Missing, expired, revoked or reused refresh token. */
export class SessionInvalidError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor(reason: string) {
    super('Session is no longer valid', { reason });
  }
}

export class TooManyAttemptsError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor(retryAfterSeconds: number) {
    super('Too many attempts, try again later', { retryAfterSeconds });
  }
}
