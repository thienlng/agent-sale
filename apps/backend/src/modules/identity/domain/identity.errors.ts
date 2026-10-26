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

/** Password was right but the account has a second factor and no code came with it. */
export class MfaRequiredError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor() {
    super('A verification code is required', { reason: 'mfa_required' });
  }
}

export class MfaCodeInvalidError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor() {
    super('Invalid verification code', { reason: 'mfa_invalid' });
  }
}

/** Re-authentication for a security change failed (not 401: the session itself is fine). */
export class MfaReauthError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: 'invalid_password' | 'invalid_code') {
    super(reason === 'invalid_password' ? 'Wrong password' : 'Invalid verification code', {
      reason,
    });
  }
}

export class MfaStateError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(reason: 'already_enabled' | 'not_enabled' | 'no_setup') {
    super('Two-factor authentication is not in the right state for this', { reason });
  }
}
