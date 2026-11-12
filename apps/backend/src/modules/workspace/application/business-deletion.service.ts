import type {
  DeletedBusinessDto,
  WorkspaceDeletionRequestedV1,
  WorkspaceDto,
  WorkspaceRestoredV1,
} from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { WORKSPACE_LIFECYCLE, type WorkspaceLifecycle } from '../api/workspace-lifecycle.js';
import {
  NotBusinessOwnerError,
  RestoreWindowClosedError,
  WorkspaceNotFoundError,
} from '../domain/workspace.errors.js';
import type { Workspace } from '../domain/workspace.js';
import { toWorkspaceDto } from './mappers.js';
import type { Actor } from './ports/audit-writer.js';
import {
  type DeletedBusiness,
  WORKSPACE_DIRECTORY,
  type WorkspaceDirectory,
} from './ports/workspace-directory.js';
import {
  WORKSPACE_UOW,
  type WorkspaceTxContext,
  type WorkspaceUnitOfWork,
} from './ports/workspace-unit-of-work.js';

/** The time source; tests pass a fixed one. */
export const WORKSPACE_CLOCK = Symbol('WORKSPACE_CLOCK');
export type Clock = () => Date;

const toDto = (d: DeletedBusiness): DeletedBusinessDto => ({
  workspaceId: d.workspaceId,
  name: d.name,
  industry: d.industry,
  icon: d.icon,
  deletedAt: d.deletedAt.toISOString(),
  purgeAfter: d.purgeAfter.toISOString(),
});

/**
 * Business deletion (SET-10, ADR-033): the owner deletes a business (soft, 30-day restore window),
 * restores it, or lists the ones still restorable. The purge itself is `WorkspacePurgeRunnerImpl`.
 */
@Injectable()
export class BusinessDeletionService {
  readonly #log = new Logger('BusinessDeletion');

  constructor(
    @Inject(WORKSPACE_UOW) private readonly uow: WorkspaceUnitOfWork,
    @Inject(WORKSPACE_DIRECTORY) private readonly directory: WorkspaceDirectory,
    @Inject(WORKSPACE_LIFECYCLE) private readonly lifecycle: WorkspaceLifecycle,
    @Inject(WORKSPACE_CLOCK) @Optional() private readonly clock: Clock = () => new Date(),
  ) {}

  /**
   * One transaction: status `pending_deletion`, `deleted_at`, `purge_after` (+30 days), audit and
   * `workspace.workspace.deletion_requested.v1`. From then on the auth guard admits nobody, the
   * business leaves every list and the billing gate stops bots, care, Brain and webhooks. Then the
   * lifecycle handlers disconnect channels and integrations (best effort, logged).
   */
  async requestDeletion(
    ws: WorkspaceId,
    actor: Actor,
    confirmName: string,
  ): Promise<DeletedBusinessDto> {
    await this.assertOwner(ws, actor.userId as UserId);
    const result = await this.uow.run(ws, async (ctx) => {
      const workspace = await this.load(ctx, ws);
      workspace.requestDeletion({
        confirmName,
        actorUserId: actor.userId as UserId,
        now: this.clock(),
      });
      await ctx.workspaces.save(workspace);
      const s = workspace.snapshot();
      const purgeAfter = (s.purgeAfter ?? new Date()).toISOString();
      await ctx.audit.record(ws, actor, {
        action: 'workspace.deletion_requested',
        targetType: 'workspace',
        targetId: ws,
        data: { purgeAfter },
      });
      for (const e of workspace.pullEvents()) {
        if (e.name !== 'workspace.deletion_requested') continue;
        const event: WorkspaceDeletionRequestedV1 = {
          type: 'workspace.workspace.deletion_requested.v1',
          workspaceId: ws,
          actorUserId: actor.userId,
          purgeAfter,
          occurredAt: e.occurredAt.toISOString(),
        };
        await ctx.events.publish(ws, { type: 'workspace', id: ws }, event);
      }
      return {
        workspaceId: ws,
        name: s.name,
        industry: s.industry,
        icon: 'building',
        deletedAt: (s.deletedAt ?? new Date()).toISOString(),
        purgeAfter,
      } satisfies DeletedBusinessDto;
    });
    const failed = await this.lifecycle.afterDeletionRequested(ws);
    // Ids and module names only.
    this.#log.log(`Business ${ws} deleted by its owner; purge after ${result.purgeAfter}`);
    if (failed.length)
      this.#log.warn(`Business ${ws}: deletion hooks failed in ${failed.join(', ')}`);
    // The listing carries the picked icon, which the aggregate does not hold.
    const listed = (await this.directory.listDeletedOwnedBy(actor.userId as UserId)).find(
      (d) => d.workspaceId === ws,
    );
    return listed ? toDto(listed) : result;
  }

  /** Back to active within the window; channels stay disconnected (the owner reconnects them). */
  async restore(ws: WorkspaceId, actor: Actor): Promise<WorkspaceDto> {
    await this.assertOwner(ws, actor.userId as UserId);
    const restored = await this.uow.run(ws, async (ctx) => {
      // Locked so a purge claim in flight is seen (`purging`: window closed). The window itself is
      // decided by one conditional UPDATE on the database clock, the same clock the purge's claim
      // uses, so a restore and a purge never both win (ADR-033 §5).
      const workspace = await this.load(ctx, ws, true);
      const now = this.clock();
      workspace.restore({ actorUserId: actor.userId as UserId, now });
      if (!(await ctx.workspaces.restoreWithinWindow(ws, now)))
        throw new RestoreWindowClosedError();
      await ctx.audit.record(ws, actor, {
        action: 'workspace.restored',
        targetType: 'workspace',
        targetId: ws,
      });
      for (const e of workspace.pullEvents()) {
        if (e.name !== 'workspace.restored') continue;
        const event: WorkspaceRestoredV1 = {
          type: 'workspace.workspace.restored.v1',
          workspaceId: ws,
          actorUserId: actor.userId,
          occurredAt: e.occurredAt.toISOString(),
        };
        await ctx.events.publish(ws, { type: 'workspace', id: ws }, event);
      }
      return workspace;
    });
    this.#log.log(`Business ${ws} restored by its owner`);
    return toWorkspaceDto(restored);
  }

  async listDeleted(userId: UserId): Promise<DeletedBusinessDto[]> {
    return (await this.directory.listDeletedOwnedBy(userId)).map(toDto);
  }

  /** Not a member: 404 (never leaks existence). A member who is not the owner: 403. */
  private async assertOwner(ws: WorkspaceId, userId: UserId): Promise<void> {
    const target = await this.directory.deletionTarget(ws, userId);
    if (!target || target.status === 'deleted') throw new WorkspaceNotFoundError(ws);
    if (target.role !== 'owner') throw new NotBusinessOwnerError();
  }

  private async load(ctx: WorkspaceTxContext, ws: WorkspaceId, lock = false): Promise<Workspace> {
    const workspace = await ctx.workspaces.findById(ws, { lock });
    if (!workspace) throw new WorkspaceNotFoundError(ws);
    return workspace;
  }
}
