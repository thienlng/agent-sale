import type { Bot } from '../bot.js';

export interface BotDeletionAudit {
  actorUserId: string | null;
  actorName: string;
  botName: string;
}

/** Bound to one tenant transaction by the unit of work. */
export interface BotRepository {
  list(): Promise<Bot[]>;
  findById(id: string): Promise<Bot | null>;
  save(bot: Bot): Promise<void>;
  /** Soft delete: stamps `deleted_at`, switches the bot off and writes the audit event. */
  softDelete(id: string, audit: BotDeletionAudit): Promise<boolean>;
}
