import type { WorkspaceId } from '@agent-sales/shared';

export type BotDeletedHandler = (workspaceId: WorkspaceId, botId: string) => Promise<void>;

/**
 * Lets modules that sit above `bot` in the module graph (channel) react when a
 * bot is deleted without `bot` importing them. Handlers run before the bot is
 * soft-deleted, so a failure leaves the bot intact and the delete can be retried.
 */
export class BotLifecycle {
  readonly #deleted: BotDeletedHandler[] = [];

  onDeleted(handler: BotDeletedHandler): void {
    this.#deleted.push(handler);
  }

  async beforeDelete(workspaceId: WorkspaceId, botId: string): Promise<void> {
    for (const handler of this.#deleted) await handler(workspaceId, botId);
  }
}

export const BOT_LIFECYCLE = Symbol('BOT_LIFECYCLE');
