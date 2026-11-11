import type { ImpactRange, ImpactResponse, TodayApprovalItem } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** Who looks at Today: sales and care (no `contacts.view_all`) see their own and unassigned. */
export interface TodayViewerRef {
  userId: string;
  viewAll: boolean;
}

/**
 * What the care module adds to Today and the briefing (ADR-031). `care` depends on `brain`, so
 * brain cannot call it: care registers this source at start-up (`BRAIN_TODAY_REGISTRY`), and
 * Today works without it (tests, a process without the care module).
 */
export interface CareTodaySource {
  /** Drafts waiting for a person ("Chờ duyệt") the viewer may see: the full count, ≤ `limit` items. */
  approvals(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    now: Date,
    limit: number,
  ): Promise<{ count: number; items: TodayApprovalItem[] }>;
  /** Conversations whose after-sales check-in is due before `before` (≤ 1 000 ids). */
  afterSaleDue(ws: WorkspaceId, before: Date): Promise<string[]>;
  /** "Rapiz đã mang lại" over the range (the Monday briefing reads `7d`). */
  impact(ws: WorkspaceId, range: ImpactRange, now: Date): Promise<ImpactResponse>;
}

export interface BrainTodayRegistry {
  registerCare(source: CareTodaySource): void;
}

export const BRAIN_TODAY_REGISTRY = Symbol('BRAIN_TODAY_REGISTRY');
