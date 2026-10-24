import { z } from 'zod';

// ─── Audit trail (T-054) ──────────────────────────────────────────────────────

export const AuditEventDto = z.object({
  id: z.uuid(),
  /** "<area>.<thing>.<verb>", e.g. `member.role_changed`. */
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  actorName: z.string().nullable(),
  /** What changed (field → {from, to}) and context; never secrets. */
  data: z.record(z.string(), z.unknown()),
  at: z.iso.datetime(),
});
export type AuditEventDto = z.infer<typeof AuditEventDto>;

export const AuditQuery = z.object({
  /** Exact action, or a prefix ending in `.` (e.g. `member.`). */
  action: z.string().max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Keyset pagination: the `at` of the last event of the previous page, with its id. */
  before: z.iso.datetime().optional(),
  beforeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.input<typeof AuditQuery>;

export const AuditList = z.object({
  data: z.array(AuditEventDto),
  /** Present when more events exist: pass as `before` / `beforeId`. */
  next: z.object({ before: z.iso.datetime(), beforeId: z.uuid() }).nullable(),
});
export type AuditList = z.infer<typeof AuditList>;
