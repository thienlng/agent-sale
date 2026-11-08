import { z } from 'zod';

// ─── Workspace data export (SET-10, spec 2026-11-08 Phase 2) ─────────────────────────────────

export const DataExportStatus = z.enum(['queued', 'running', 'ready', 'failed', 'expired']);
export type DataExportStatus = z.infer<typeof DataExportStatus>;

export const DataExportDto = z.object({
  id: z.uuid(),
  status: DataExportStatus,
  includeMedia: z.boolean(),
  /** Bytes of the ZIP once `ready`. */
  sizeBytes: z.number().int().nullable(),
  /** Stable code when `failed` (e.g. `source_failed`, `upload_failed`, `lease_expired`). */
  errorCode: z.string().nullable(),
  requestedByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /** When the file is deleted (7 days after it is ready). */
  expiresAt: z.iso.datetime().nullable(),
});
export type DataExportDto = z.infer<typeof DataExportDto>;

export const DataExportList = z.object({
  data: z.array(DataExportDto),
  /** Exports started in the last 24 hours and the daily limit. */
  usedToday: z.number().int(),
  dailyLimit: z.number().int(),
});
export type DataExportList = z.infer<typeof DataExportList>;

export const CreateDataExportBody = z.object({
  includeMedia: z.boolean().default(false),
});
export type CreateDataExportBody = z.input<typeof CreateDataExportBody>;

/** A one-time download link (5 minutes): the browser downloads the ZIP directly, streamed. */
export const DataExportLink = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DataExportLink = z.infer<typeof DataExportLink>;

/**
 * One file of an export, produced by the module that owns the data (`<MODULE>_EXPORT` tokens).
 * `rows()` yields pages of rows in `columns` order; cells are plain values (Date, JSON values).
 * `mediaColumns`: columns holding picture/file URLs (string or string[]) that the archive copies
 * into `media/` when the owner asks for files.
 */
export type ExportCell = string | number | boolean | bigint | Date | null | object;
export interface ExportTable {
  file: string;
  columns: readonly string[];
  rows(): AsyncIterable<readonly ExportCell[][]>;
  mediaColumns?: readonly string[];
}
/** What a data-owning module exposes for the export (read-only, under the workspace's RLS). */
export interface WorkspaceExportSource {
  exportTables(workspaceId: string): readonly ExportTable[];
}
