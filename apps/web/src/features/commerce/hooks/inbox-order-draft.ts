import { useSyncExternalStore } from 'react';
import type { ContactDto, OrderSource } from '@agent-sales/contracts';
import type { Line } from '../components/order-lines';
import type { PaymentState } from '../components/order-payment';
import type { PeopleState } from '../components/order-people';

export interface InboxOrderDraft {
  clientRequestId: string;
  warehouseId: string;
  lines: Line[];
  payment: PaymentState;
  people: PeopleState;
  noteInternal: string;
  notePrint: string;
}

// Tab memory only: no customer information is written to persistent browser storage.
const drafts = new Map<string, InboxOrderDraft>();
export function readOrderDraft(key: string): InboxOrderDraft | undefined {
  return drafts.get(key);
}
export function saveOrderDraft(key: string, draft: InboxOrderDraft): void {
  if (!drafts.has(key) && drafts.size >= 100) {
    const oldest = drafts.keys().next().value;
    if (oldest) drafts.delete(oldest);
  }
  drafts.set(key, draft);
}
export function clearOrderDraft(key: string): void {
  drafts.delete(key);
}
export interface InboxOrderContext {
  draftKey: string;
  customerName: string;
  source: OrderSource;
  contact?: ContactDto | undefined;
}

const pending = new Set<string>();
const listeners = new Set<() => void>();
export function beginOrderSubmission(key: string): boolean {
  if (pending.has(key)) return false;
  pending.add(key);
  listeners.forEach((listener) => listener());
  return true;
}
export function finishOrderSubmission(key: string): void {
  pending.delete(key);
  listeners.forEach((listener) => listener());
}
export function useOrderDraftPending(key: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => pending.has(key),
  );
}
