/** Rules of the whole-workspace data export (SET-10, spec 2026-11-08 Phase 2 §2.1). */
export const EXPORT_DAILY_LIMIT = 3;
export const EXPORT_KEEP_DAYS = 7;
export const EXPORT_LINK_TTL_MS = 5 * 60_000;
/** A running export whose worker died is retried once, then failed with `lease_expired`. */
export const EXPORT_LEASE_MS = 30 * 60_000;
export const EXPORT_MAX_ATTEMPTS = 2;

export type DataExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

export interface DataExportRecord {
  id: string;
  workspaceId: string;
  requestedByUserId: string;
  requestedByName: string | null;
  includeMedia: boolean;
  status: DataExportStatus;
  attempts: number;
  objectKey: string | null;
  sizeBytes: number | null;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  expiresAt: Date | null;
}

/** Object key of an export in the private bucket: never guessable from outside. */
export function exportObjectKey(workspaceId: string, exportId: string): string {
  return `exports/${workspaceId}/${exportId}.zip`;
}

/** `rapiz-<business slug>-<UTC date>.zip`; the slug is ASCII (Vietnamese marks removed). */
export function exportFileName(businessName: string, at: Date): string {
  const slug = businessName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `rapiz-${slug || 'business'}-${at.toISOString().slice(0, 10)}.zip`;
}
