/**
 * What new orders can take of a KiotViet variant (spec §5.2): Σ over the sale branches of
 * max(0, onHand − reserved). Branches missing from the inventory count as zero.
 */
export function availableBySaleBranches(
  inv: ReadonlyArray<{ branchId: number; onHand: number; reserved: number }>,
  saleBranchIds: readonly number[],
): number {
  const sale = new Set(saleBranchIds);
  let total = 0;
  for (const row of inv) {
    if (sale.has(row.branchId)) total += Math.max(0, row.onHand - row.reserved);
  }
  return Math.floor(total);
}
