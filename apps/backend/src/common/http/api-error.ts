import type { ErrorCode } from '@agent-sales/contracts';
import { DomainError } from '@agent-sales/shared';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 402,
  FEATURE_LOCKED: 402,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** HTTP-facing error with a shared ErrorCode. Thrown by interface/ and common/ only. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    private readonly statusOverride?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.statusOverride ?? STATUS[this.code];
  }

  /**
   * Maps a typed domain error (packages/shared DomainError) to the HTTP envelope. A module code
   * that is not a shared ErrorCode (e.g. lodging `NIGHTS_TAKEN`, `STALE_VERSION`) answers 409
   * CONFLICT and keeps the module code in `details.reason` so clients can tell them apart.
   */
  static fromDomain(error: DomainError): ApiError {
    if ((Object.keys(STATUS) as ErrorCode[]).includes(error.code as ErrorCode))
      return new ApiError(error.code as ErrorCode, error.message, error.details);
    return new ApiError('CONFLICT', error.message, { ...error.details, reason: error.code });
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
