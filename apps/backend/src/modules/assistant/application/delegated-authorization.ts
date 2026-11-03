import type { AccessDelegation } from '../domain/ports/access-delegation.port.js';

/** Margin past the turn budget, for the last model call and its tool calls (QA N-3). */
export const DELEGATION_MARGIN_SECONDS = 180;
/** An approval (an import runs many writes) gets the longest delegated lifetime. */
export const APPROVAL_DELEGATION_SECONDS = 600;

/**
 * The `Authorization` header the assistant's route calls use for one turn or one approval: a
 * freshly minted delegated token lasting `ttlSeconds`, or the caller's own header when nothing
 * can be minted (no delegation wired, an API key, a failure). Held in memory only; never logged.
 */
export async function delegatedAuthorization(
  delegation: AccessDelegation | null,
  authorization: string,
  ttlSeconds: number,
): Promise<string> {
  if (!delegation) return authorization;
  try {
    const token = await delegation.delegate(authorization, ttlSeconds);
    return token ? `Bearer ${token}` : authorization;
  } catch {
    return authorization;
  }
}
