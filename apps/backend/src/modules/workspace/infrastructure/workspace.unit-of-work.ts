import { type Database, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  WorkspaceTxContext,
  WorkspaceUnitOfWork,
} from '../application/ports/workspace-unit-of-work.js';
import { InMemoryEventPublisher } from './messaging/in-memory-event-publisher.js';
import { OutboxEventPublisher } from './messaging/outbox-event-publisher.js';
import {
  DrizzleMemberRepository,
  DrizzleWorkspaceRepository,
} from './persistence/workspace.drizzle-repository.js';
import {
  InMemoryMemberRepository,
  InMemoryWorkspaceRepository,
} from './persistence/workspace.in-memory-repository.js';

/** Production unit of work: one withTenant transaction per `run` (ADR-004). */
export class DrizzleWorkspaceUnitOfWork implements WorkspaceUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(workspaceId: WorkspaceId, fn: (ctx: WorkspaceTxContext) => Promise<T>): Promise<T> {
    return withTenant(this.db, workspaceId, (tx) =>
      fn({
        workspaces: new DrizzleWorkspaceRepository(tx),
        members: new DrizzleMemberRepository(tx),
        events: new OutboxEventPublisher(tx),
      }),
    );
  }
}

/** Unit-test / DB-less unit of work. Not transactional; state is shared across runs. */
export class InMemoryWorkspaceUnitOfWork implements WorkspaceUnitOfWork {
  readonly workspaces = new InMemoryWorkspaceRepository();
  readonly members = new InMemoryMemberRepository();
  readonly events = new InMemoryEventPublisher();

  run<T>(_workspaceId: WorkspaceId, fn: (ctx: WorkspaceTxContext) => Promise<T>): Promise<T> {
    return fn({ workspaces: this.workspaces, members: this.members, events: this.events });
  }
}
