import type { WorkspaceId } from '@agent-sales/shared';

import type { WorkspaceRepository } from '../../domain/ports/workspace.repository.js';
import { Workspace } from '../../domain/workspace.js';

/** In-memory adapter for unit tests and local prototyping. */
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
