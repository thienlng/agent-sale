import type { ExportTable } from '@agent-sales/contracts';

export const EXPORT_FILE_STORAGE = Symbol('EXPORT_FILE_STORAGE');
export const EXPORT_ARCHIVE_WRITER = Symbol('EXPORT_ARCHIVE_WRITER');

/** The private exports bucket (never public-read) plus read access to the shop's media. */
export interface ExportFileStorage {
  available(): boolean;
  /** Uploads a local file (streamed) to the exports bucket. */
  upload(key: string, filePath: string, sizeBytes: number): Promise<void>;
  /** Streams an export file. */
  open(key: string): Promise<{ body: AsyncIterable<Uint8Array>; sizeBytes: number | null }>;
  remove(key: string): Promise<void>;
  /**
   * A Rapiz-stored picture or file by its public URL or `/media/<key>` path, streamed; null for
   * links outside Rapiz storage (they stay as links in the CSV) or objects that no longer exist.
   */
  readMedia(url: string): Promise<{ key: string; body: AsyncIterable<Uint8Array> } | null>;
}

export interface ArchiveCounts {
  /** Rows per CSV file. */
  rows: Record<string, number>;
  mediaFiles: number;
  /** Media URLs that could not be copied (outside Rapiz storage, or gone). */
  mediaSkipped: number;
  /** Media left out because the archive reached its size budget. */
  mediaOverBudget: number;
}

export interface WrittenArchive {
  path: string;
  sizeBytes: number;
  counts: ArchiveCounts;
  /** Deletes the local file. */
  cleanup(): Promise<void>;
}

/** Builds the ZIP on local disk: one CSV per table, `media/` when asked, then `README.txt`. */
export interface ExportArchiveWriter {
  write(input: {
    tables: readonly ExportTable[];
    includeMedia: boolean;
    readme: (counts: ArchiveCounts) => string;
    /** Called after each table and every 50 media files (the runner renews its lease). */
    heartbeat?: () => Promise<void>;
  }): Promise<WrittenArchive>;
  /** Deletes temp folders of builds older than `olderThanMs` (a worker that died mid-build). */
  sweep(olderThanMs: number): Promise<void>;
}

/** The archive would pass the ZIP32 limit with its data alone. */
export class ArchiveTooLargeError extends Error {
  constructor() {
    super('too_large');
  }
}
