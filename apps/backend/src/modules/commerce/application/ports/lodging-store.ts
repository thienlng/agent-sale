import type { StayRequestDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type { ProductRecord } from './commerce-store.js';

export interface StoredStay extends StayRequestDto {
  fingerprint: string;
}
export interface LodgingTx {
  property(id: string, lock?: boolean): Promise<ProductRecord | null>;
  lockRequestKey(key: string): Promise<void>;
  find(id: string, lock?: boolean): Promise<StoredStay | null>;
  findRequest(key: string): Promise<StoredStay | null>;
  list(filter: {
    propertyId?: string | undefined;
    status?: string | undefined;
    offset?: number | undefined;
  }): Promise<StoredStay[]>;
  overlaps(
    propertyId: string,
    checkIn: string,
    checkOut: string,
    excludeId?: string,
  ): Promise<boolean>;
  insert(row: StoredStay): Promise<void>;
  update(row: StoredStay): Promise<void>;
  audit(actorId: string, id: string, status: string): Promise<void>;
}
export interface LodgingStore {
  run<T>(workspaceId: WorkspaceId, fn: (tx: LodgingTx) => Promise<T>): Promise<T>;
}
export const LODGING_STORE = Symbol('LODGING_STORE');
