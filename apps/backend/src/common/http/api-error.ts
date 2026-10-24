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
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return STATUS[this.code];
  }

  /** Maps a typed domain error (packages/shared DomainError) to the HTTP envelope. */
  static fromDomain(error: DomainError): ApiError {
    const code = (Object.keys(STATUS) as ErrorCode[]).includes(error.code as ErrorCode)
      ? (error.code as ErrorCode)
      : 'CONFLICT';
    return new ApiError(code, error.message, error.details);
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
