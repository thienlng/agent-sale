/** One member who receives new customers, with their share. */
export interface Candidate {
  userId: string;
  weight: number;
}

/**
 * Weighted round robin: the `cursor`-th customer goes to the member whose block
 * of `weight` slots contains `cursor mod Σweights`, in list order. Over each
 * cycle every member gets exactly their weight; the same cursor always picks
 * the same member (deterministic). Returns null when nobody can receive.
 */
export function pickCandidate(candidates: readonly Candidate[], cursor: number): string | null {
  const total = candidates.reduce((n, c) => n + c.weight, 0);
  if (total <= 0) return null;
  let slot = cursor % total;
  for (const c of candidates) {
    if (slot < c.weight) return c.userId;
    slot -= c.weight;
  }
  return null;
}
