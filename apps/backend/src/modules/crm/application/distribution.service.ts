import { type AssignmentPolicyDto, PutAssignmentPolicyRequest } from '@agent-sales/contracts';
import { isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  CrmOptionNotFoundError,
  NotAMemberError,
  StaleVersionError,
} from '../domain/crm.errors.js';
import { pickCandidate } from '../domain/distribution.js';
import { CRM_STORE, type CrmStore, type CrmTx } from './ports/crm-store.js';

/**
 * Per-source auto-assignment of new customers to Sales (SET-02, T-033): a
 * weighted round robin whose cursor lives on the policy row, which is locked
 * while picking, so concurrent creates never pick from the same slot.
 */
@Injectable()
export class DistributionService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  /** One entry per active source; sources never configured come back disabled (version 0). */
  list(ws: WorkspaceId): Promise<AssignmentPolicyDto[]> {
    return this.store.run(ws, async (tx) => {
      const [sources, policies] = await Promise.all([
        tx.options.list('source'),
        tx.policies.list(),
      ]);
      return sources
        .filter((s) => !s.archivedAt)
        .map((s) => {
          const p = policies.find((x) => x.sourceId === s.id);
          return p
            ? { sourceId: s.id, enabled: p.enabled, candidates: p.candidates, version: p.version }
            : { sourceId: s.id, enabled: false, candidates: [], version: 0 };
        });
    });
  }

  async put(ws: WorkspaceId, sourceId: string, raw: unknown): Promise<AssignmentPolicyDto> {
    const input = PutAssignmentPolicyRequest.parse(raw);
    const members = new Set((await this.workspaces.listMembers(ws)).map((m) => String(m.userId)));
    for (const c of input.candidates) {
      if (!members.has(c.userId)) throw new NotAMemberError('sales', c.userId);
    }
    return this.store.run(ws, async (tx) => {
      if (!isUuid(sourceId) || !(await tx.options.find('source', sourceId))) {
        throw new CrmOptionNotFoundError('source', sourceId);
      }
      const saved = await tx.policies.save(
        { sourceId, enabled: input.enabled, candidates: input.candidates },
        input.expectedVersion,
      );
      if (saved === null) {
        const current = await tx.policies.find(sourceId);
        throw new StaleVersionError('policy', current?.version ?? 0);
      }
      return { sourceId, enabled: input.enabled, candidates: input.candidates, version: saved };
    });
  }

  /**
   * The Sales member for a new customer from `sourceId`, or null (no enabled
   * policy, or none of its members is still active). Advances the cursor.
   * Runs inside the caller's transaction so the pick and the insert commit together.
   */
  async pick(tx: CrmTx, ws: WorkspaceId, sourceId: string): Promise<string | null> {
    const policy = await tx.policies.find(sourceId, { forUpdate: true });
    if (!policy?.enabled) return null;
    const active = new Set((await this.workspaces.listMembers(ws)).map((m) => String(m.userId)));
    const candidates = policy.candidates.filter((c) => active.has(c.userId));
    const chosen = pickCandidate(candidates, policy.cursor);
    if (chosen) await tx.policies.advance(sourceId);
    return chosen;
  }
}
