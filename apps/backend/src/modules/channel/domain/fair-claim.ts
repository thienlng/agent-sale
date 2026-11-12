/** What the inbox claim knows about a candidate event before it takes it. */
export interface ClaimCandidate {
  workspaceId: string;
  connectionId: string;
  /** The customer the event belongs to (empty for events without one). */
  senderExternalId: string;
}

/** How many candidate rows a claim reads per event it may return (bounded, see `scanLimit`). */
export const CLAIM_SCAN_FACTOR = 4;
export const CLAIM_SCAN_MAX = 200;

export const scanLimit = (limit: number) => Math.min(CLAIM_SCAN_MAX, limit * CLAIM_SCAN_FACTOR);

/**
 * Per-workspace fairness of one inbox claim (security audit 2026-11-12 #3). Candidates come
 * oldest first; a workspace may take at most `perWorkspace` distinct conversations (connection +
 * customer) per claim, so one shop under a message flood cannot fill the claim while other
 * shops wait. Every event of an admitted conversation is kept (a burst stays one turn). Pure.
 */
export function pickFair<T extends ClaimCandidate>(
  candidates: readonly T[],
  limit: number,
  perWorkspace: number | undefined,
): T[] {
  if (!perWorkspace || perWorkspace <= 0) return candidates.slice(0, limit);
  const admitted = new Set<string>();
  const perWs = new Map<string, number>();
  const picked: T[] = [];
  for (const c of candidates) {
    if (picked.length >= limit) break;
    const conversation = `${c.workspaceId}/${c.connectionId}/${c.senderExternalId}`;
    if (!admitted.has(conversation)) {
      const taken = perWs.get(c.workspaceId) ?? 0;
      if (taken >= perWorkspace) continue;
      perWs.set(c.workspaceId, taken + 1);
      admitted.add(conversation);
    }
    picked.push(c);
  }
  return picked;
}
