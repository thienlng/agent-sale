/**
 * Trades the caller's `Authorization` header for a short-lived delegated access token of the
 * same user and session (identity's `IDENTITY_DELEGATION_FACADE`, ADR-023), so route calls inside
 * one turn or one approval do not fail when the caller's own 15-min token expires mid-way.
 * Returns the bare token, or null when the header cannot be delegated.
 */
export interface AccessDelegation {
  delegate(authorization: string, ttlSeconds: number): Promise<string | null>;
}
export const ACCESS_DELEGATION = Symbol('ACCESS_DELEGATION');
