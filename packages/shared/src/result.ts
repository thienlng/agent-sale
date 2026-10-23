/**
 * Result type for expected failures (validation, not-found, quota…).
 * Throw only for programmer errors and infrastructure failures.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Base class for typed domain errors; `code` maps to an ErrorCode in contracts. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
