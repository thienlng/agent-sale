/** Worker side of the data export (SET-10), run every few seconds by apps/backend worker. */
export interface DataExportRunner {
  /** Expires old files, then builds at most one queued export. Returns how many it built. */
  tick(now?: Date): Promise<number>;
}

export const DATAEXPORT_RUNNER = Symbol('DATAEXPORT_RUNNER');
