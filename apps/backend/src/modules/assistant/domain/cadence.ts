/**
 * When a schedule runs (T-172, S3-R3): a structured cadence, never cron. Every `at`,
 * `activeFrom` and `activeTo` is local time in Asia/Ho_Chi_Minh (UTC+7, no DST).
 */
export type Cadence =
  | { kind: 'daily'; at: string }
  | { kind: 'weekly'; days: number[]; at: string }
  | { kind: 'monthly'; day: number; at: string }
  | { kind: 'every'; minutes: number; activeFrom?: string; activeTo?: string };
