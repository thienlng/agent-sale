import { type Database, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ActionRepository,
  ActionUnitOfWork,
} from '../application/ports/action-unit-of-work.js';
import { DrizzleActionRepository } from './persistence/action.drizzle-repository.js';

export class DrizzleActionUnitOfWork implements ActionUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(ws: WorkspaceId, fn: (repository: ActionRepository) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) => fn(new DrizzleActionRepository(tx, ws)));
  }
}
