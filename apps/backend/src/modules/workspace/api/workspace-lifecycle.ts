import type { WorkspaceId } from '@agent-sales/shared';

export type WorkspaceDeletionHandler = (workspaceId: WorkspaceId) => Promise<void>;

/**
 * Lets modules above `workspace` in the module graph react when an owner deletes a business
 * (ADR-032) without `workspace` importing them, like `BotLifecycle`. `channel` disconnects every
 * page and turns website chat off; `integration` disconnects KiotViet. Handlers run after the
 * deletion committed (the business is already blocked by every gate), each on its own: a failing
 * handler is logged and does not stop the others nor fail the request.
 */
export class WorkspaceLifecycle {
  readonly #deletionRequested: Array<{ name: string; handler: WorkspaceDeletionHandler }> = [];

  /** `name` identifies the handler in logs (a module name; never data). */
  onDeletionRequested(name: string, handler: WorkspaceDeletionHandler): void {
    this.#deletionRequested.push({ name, handler });
  }

  /** Runs every handler; returns the names of those that failed. */
  async afterDeletionRequested(workspaceId: WorkspaceId): Promise<string[]> {
    const failed: string[] = [];
    for (const { name, handler } of this.#deletionRequested) {
      try {
        await handler(workspaceId);
      } catch {
        failed.push(name);
      }
    }
    return failed;
  }
}

export const WORKSPACE_LIFECYCLE = Symbol('WORKSPACE_LIFECYCLE');
