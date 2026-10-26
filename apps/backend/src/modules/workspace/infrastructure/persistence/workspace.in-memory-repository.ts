import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type { MemberRepository, Membership } from '../../domain/ports/member.repository.js';
import type { WorkspaceRepository } from '../../domain/ports/workspace.repository.js';
import { Workspace } from '../../domain/workspace.js';

/** In-memory adapters for unit tests and DB-less local runs. */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  readonly #rows = new Map<string, ReturnType<Workspace['snapshot']>>();

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    const row = this.#rows.get(id);
    return row ? Workspace.rehydrate({ ...row }) : null;
  }

  async save(workspace: Workspace): Promise<void> {
    this.#rows.set(workspace.id, workspace.snapshot());
  }
}

export class InMemoryMemberRepository implements MemberRepository {
  readonly rows: Membership[] = [];

  async add(membership: Membership): Promise<void> {
    this.rows.push(membership);
  }

  async lockSeats(): Promise<void> {}

  async countActive(workspaceId: WorkspaceId): Promise<number> {
    return this.rows.filter((m) => m.workspaceId === workspaceId && m.status === 'active').length;
  }

  async update(membership: Membership): Promise<void> {
    const i = this.rows.findIndex((m) => m.id === membership.id);
    if (i >= 0) this.rows[i] = membership;
  }

  async find(workspaceId: WorkspaceId, userId: UserId): Promise<Membership | null> {
    return this.rows.find((m) => m.workspaceId === workspaceId && m.userId === userId) ?? null;
  }
}
