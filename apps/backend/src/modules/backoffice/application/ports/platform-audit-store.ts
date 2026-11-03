/** One platform-operator action (ADR-021 §6), as stored. */
export interface PlatformAuditRecord {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface PlatformAuditFilter {
  targetType?: string | undefined;
  targetId?: string | undefined;
  /** Keyset: entries strictly older than this one. */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

/** Read side of `platform_audit_events` (rows are appended by the owning modules' transactions). */
export interface PlatformAuditStore {
  list(filter: PlatformAuditFilter): Promise<PlatformAuditRecord[]>;
}

export const PLATFORM_AUDIT_STORE = Symbol('PLATFORM_AUDIT_STORE');
