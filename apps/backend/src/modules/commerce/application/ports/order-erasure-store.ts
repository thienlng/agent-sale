import type { WorkspaceId } from '@agent-sales/shared';

/** What anonymizing an order needs (the search text is rebuilt from it). */
export interface ErasableOrder {
  id: string;
  code: string;
  trackingCode: string | null;
  customer: Record<string, unknown>;
  recipient: Record<string, unknown>;
  noteInternal: string;
  notePrint: string;
}

export interface OrderErasureTx {
  /**
   * Orders of these conversations, or whose customer phone (digits only) is one of `phoneDigits`,
   * deleted ones included.
   */
  ordersOf(
    conversationIds: readonly string[],
    phoneDigits: readonly string[],
  ): Promise<ErasableOrder[]>;
  anonymize(
    id: string,
    people: { customer: Record<string, unknown>; recipient: Record<string, unknown> },
    searchText: string,
  ): Promise<void>;
  /** Bot order drafts (a summary awaiting "đặt") of these conversations. */
  deleteDrafts(conversationIds: readonly string[]): Promise<void>;
}

/** Customer deletion's part in commerce (docs/09 §10); one tenant transaction per call. */
export interface OrderErasureStore {
  run<T>(ws: WorkspaceId, fn: (tx: OrderErasureTx) => Promise<T>): Promise<T>;
}
export const ORDER_ERASURE_STORE = Symbol('ORDER_ERASURE_STORE');
