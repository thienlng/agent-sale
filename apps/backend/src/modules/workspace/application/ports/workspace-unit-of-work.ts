import type { WorkspaceId } from '@agent-sales/shared';

import type { MemberRepository } from '../../domain/ports/member.repository.js';
import type { WorkspaceRepository } from '../../domain/ports/workspace.repository.js';
import type { EventPublisher } from './event-publisher.js';

/** Everything a handler may touch inside one transaction. */
export interface WorkspaceTxContext {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  events: EventPublisher;
}

/**
 * Unit of work: `run` executes `fn` in ONE transaction scoped to `workspaceId`
 * (RLS context, ADR-004). Everything commits together or not at all.
 * Pattern to copy in every module that writes more than one thing.
 */
export interface WorkspaceUnitOfWork {
  run<T>(workspaceId: WorkspaceId, fn: (ctx: WorkspaceTxContext) => Promise<T>): Promise<T>;
}

export const WORKSPACE_UOW = Symbol('WORKSPACE_UOW');
