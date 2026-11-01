import type { KiotVietBranch } from '@agent-sales/contracts';

export interface BranchSelection {
  saleBranchIds: number[];
  orderBranchId: number | null;
}

/** All ticked when the store has one branch, none pre-ticked otherwise (spec §6.3). */
export function defaultSelection(branches: readonly KiotVietBranch[]): BranchSelection {
  const only = branches.length === 1 ? branches[0] : undefined;
  return only
    ? { saleBranchIds: [only.id], orderBranchId: only.id }
    : { saleBranchIds: [], orderBranchId: null };
}

/** Keeps what the user picked if those branches still exist, else starts over. */
export function reconcileSelection(
  branches: readonly KiotVietBranch[],
  current: BranchSelection,
): BranchSelection {
  const ids = new Set(branches.map((b) => b.id));
  const kept = current.saleBranchIds.filter((id) => ids.has(id));
  if (!kept.length || kept.length !== current.saleBranchIds.length)
    return defaultSelection(branches);
  return {
    saleBranchIds: kept,
    orderBranchId:
      current.orderBranchId !== null && kept.includes(current.orderBranchId)
        ? current.orderBranchId
        : null,
  };
}

/** Ticks or unticks a sale branch; the order branch follows (cleared, or the only one left). */
export function toggleBranch(
  current: BranchSelection,
  id: number,
  checked: boolean,
): BranchSelection {
  const saleBranchIds = checked
    ? [...new Set([...current.saleBranchIds, id])]
    : current.saleBranchIds.filter((x) => x !== id);
  let orderBranchId =
    current.orderBranchId !== null && saleBranchIds.includes(current.orderBranchId)
      ? current.orderBranchId
      : null;
  if (orderBranchId === null && saleBranchIds.length === 1)
    orderBranchId = saleBranchIds[0] ?? null;
  return { saleBranchIds, orderBranchId };
}

export interface BranchErrors {
  branches?: string;
  orderBranch?: string;
}

export function validateSelection(
  selection: BranchSelection,
  messages: { branches: string; orderBranch: string },
): BranchErrors {
  if (!selection.saleBranchIds.length) return { branches: messages.branches };
  if (
    selection.orderBranchId === null ||
    !selection.saleBranchIds.includes(selection.orderBranchId)
  )
    return { orderBranch: messages.orderBranch };
  return {};
}
