import type { Bot } from '../bot.js';

/** Bound to one tenant transaction by the unit of work. */
export interface BotRepository {
  list(): Promise<Bot[]>;
  findById(id: string): Promise<Bot | null>;
  save(bot: Bot): Promise<void>;
}
