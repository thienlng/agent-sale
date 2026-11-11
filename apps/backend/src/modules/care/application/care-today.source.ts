import type { ImpactRange, ImpactResponse, TodayApprovalItem } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import {
  BRAIN_TODAY_REGISTRY,
  type BrainTodayRegistry,
  type CareTodaySource,
  type TodayViewerRef,
} from '../../brain/api/index.js';
import { CARE_STORE, type CareStore } from '../domain/ports/care.store.js';
import { ApprovalService } from './approval.service.js';
import { ImpactQuery } from './impact.query.js';

/**
 * What care adds to Today and the morning briefing ("Chờ duyệt", after-sales check-ins, the
 * weekly impact), registered with the brain module at start-up (brain cannot depend on care).
 */
@Injectable()
export class CareTodaySourceImpl implements CareTodaySource, OnModuleInit {
  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(ApprovalService) private readonly approvalService: ApprovalService,
    @Inject(ImpactQuery) private readonly impactQuery: ImpactQuery,
    @Inject(BRAIN_TODAY_REGISTRY) @Optional() private readonly registry?: BrainTodayRegistry,
  ) {}

  onModuleInit(): void {
    this.registry?.registerCare(this);
  }

  approvals(
    ws: WorkspaceId,
    viewer: TodayViewerRef,
    now: Date,
    limit: number,
  ): Promise<{ count: number; items: TodayApprovalItem[] }> {
    return this.approvalService.approvals(ws, viewer, now, limit);
  }

  afterSaleDue(ws: WorkspaceId, before: Date): Promise<string[]> {
    return this.store.afterSaleDue(ws, before, new Date());
  }

  impact(ws: WorkspaceId, range: ImpactRange, now: Date): Promise<ImpactResponse> {
    return this.impactQuery.impact(ws, range, now);
  }
}
