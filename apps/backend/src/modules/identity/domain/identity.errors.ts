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

export class ApiKeyNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('API key not found');
  }
}

export class InvalidApiKeyInputError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

/** The plan of the workspace does not include the public API (ADR-022 §4). */
export class PublicApiLockedError extends DomainError {
  readonly code = 'FEATURE_LOCKED';
  constructor() {
    super('The public API is not included in this plan', { feature: 'feature.public_api' });
  }
}

/** A wrong, used-up or expired emailed code (email verification, password reset). */
export class EmailCodeError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: 'code_invalid' | 'code_expired') {
    super(reason === 'code_invalid' ? 'Invalid code' : 'The code has expired, request a new one', {
      reason,
    });
  }
}

/** The first-business step is only for a user who owns no account yet. */
export class SignupBusinessDoneError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This user already owns an account; create businesses there', {
      reason: 'account_exists',
    });
  }
}

export type GoogleSignInFailure =
  /** Not configured on this server. */
  | 'unavailable'
  /** The user cancelled on Google's screen. */
  | 'cancelled'
  /** The sign-in took too long, or the browser lost the flow cookie (state mismatch). */
  | 'expired'
  /** Google does not vouch for the email address. */
  | 'unverified_email'
  /**
   * A Rapiz account already uses the address and Google is not authoritative for it (not Gmail, no
   * matching Workspace domain), so it is not linked: sign in with the password instead.
   */
  | 'account_exists'
  /** Google answered with an error or a token that did not verify. */
  | 'failed';

/**
 * The action needs a recent re-authentication of this session (step-up: password, two-factor code,
 * emailed code or a new Google sign-in). 403, not 401: the session itself is fine.
 *
 * `explicit`: a recent sign-in does not count, only `POST /auth/reauth` does (reason
 * `step_up_required`; a new Google sign-in opens another session, so it does not help either).
 */
export class ReauthRequiredError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor(explicit = false) {
    super('Confirm it is you to continue', {
      reason: explicit ? 'step_up_required' : 'reauth_required',
    });
  }
}

/** The last way to sign in cannot be removed (a user without a password keeps one link). */
export class LastSignInMethodError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('Set a password before removing your last sign-in method', {
      reason: 'last_sign_in_method',
    });
  }
}

export class LinkedIdentityNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Linked sign-in not found');
  }
}

/** A Google sign-in that cannot finish; the reason is shown on the login page. */
export class GoogleSignInError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor(readonly reason: GoogleSignInFailure) {
    super('Google sign-in did not complete', { reason: `google_${reason}` });
  }
}
