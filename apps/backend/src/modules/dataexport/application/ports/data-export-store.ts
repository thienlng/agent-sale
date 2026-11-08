import type { DataExportRecord } from '../../domain/data-export.js';

export const DATA_EXPORT_STORE = Symbol('DATA_EXPORT_STORE');

/** Persistence of `data_exports`. Workspace methods run under RLS; worker methods are system-wide. */
export interface DataExportStore {
  list(workspaceId: string, limit: number): Promise<DataExportRecord[]>;
  get(workspaceId: string, id: string): Promise<DataExportRecord | null>;
  /** Exports requested since `since` (the daily limit). */
  countSince(workspaceId: string, since: Date): Promise<number>;
  /** A queued or running export exists. */
  hasActive(workspaceId: string): Promise<boolean>;
  /** Inserts a queued export and its audit event (`workspace.data_exported`) in one transaction. */
  create(input: {
    id: string;
    workspaceId: string;
    requestedByUserId: string;
    requestedByName: string | null;
    includeMedia: boolean;
  }): Promise<DataExportRecord>;
  /** Stores a one-time link (hash only) on a ready export; false if it is not ready. */
  setLink(workspaceId: string, id: string, tokenHash: string, expiresAt: Date): Promise<boolean>;

  /**
   * Worker: claims the oldest queued export (or one whose lease ran out, below `maxAttempts`)
   * as running with a lease; exports out of attempts are failed with `lease_expired` first.
   */
  claim(now: Date, leaseMs: number, maxAttempts: number): Promise<DataExportRecord | null>;
  finishReady(
    id: string,
    r: { objectKey: string; sizeBytes: number; at: Date; expiresAt: Date },
  ): Promise<void>;
  finishFailed(id: string, errorCode: string, at: Date): Promise<void>;
  /** Ready exports past `expires_at` become `expired`; returns them so their files are deleted. */
  expireDue(now: Date, limit: number): Promise<DataExportRecord[]>;
  /**
   * Link download: clears the token (one use) and returns the export when the token is valid
   * and the export still ready; writes the `workspace.data_export_downloaded` audit event.
   */
  consumeLink(tokenHash: string, now: Date): Promise<DataExportRecord | null>;
}
