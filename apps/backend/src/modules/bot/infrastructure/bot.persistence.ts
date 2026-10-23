import { type Database, eq, isNull, schema, type TenantTx, withTenant } from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';

import type { BotTxContext, BotUnitOfWork } from '../application/ports/bot-unit-of-work.js';
import { Bot } from '../domain/bot.js';
import type { BotSettingsData, IndustryKey } from '../domain/bot-settings.js';
import type { BotRepository } from '../domain/ports/bot.repository.js';

type Row = typeof schema.bots.$inferSelect;
const t = schema.bots;

function toBot(r: Row): Bot {
  return Bot.rehydrate({
    id: r.id,
    workspaceId: workspaceId(r.workspaceId),
    name: r.name,
    industry: r.industry as IndustryKey,
    isActive: r.isActive,
    settings: r.settings as unknown as BotSettingsData,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

export class DrizzleBotRepository implements BotRepository {
  constructor(private readonly tx: TenantTx) {}

  async list(): Promise<Bot[]> {
    return (await this.tx.select().from(t).where(isNull(t.deletedAt)).orderBy(t.createdAt)).map(
      toBot,
    );
  }

  async findById(id: string): Promise<Bot | null> {
    const [r] = await this.tx.select().from(t).where(eq(t.id, id)).limit(1);
    return r && !r.deletedAt ? toBot(r) : null;
  }

  async save(bot: Bot): Promise<void> {
    const s = bot.snapshot();
    const row = {
      id: s.id,
      workspaceId: s.workspaceId,
      name: s.name,
      industry: s.industry,
      isActive: s.isActive,
      settings: s.settings as unknown as Record<string, unknown>,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
    await this.tx
      .insert(t)
      .values(row)
      .onConflictDoUpdate({
        target: t.id,
        set: {
          name: row.name,
          isActive: row.isActive,
          settings: row.settings,
          updatedAt: row.updatedAt,
        },
      });
  }
}

export class DrizzleBotUnitOfWork implements BotUnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(ws: WorkspaceId, fn: (ctx: BotTxContext) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) => fn({ bots: new DrizzleBotRepository(tx) }));
  }
}

/** DB-less adapters; rows are partitioned by workspace to mimic RLS in tests. */
export class InMemoryBotUnitOfWork implements BotUnitOfWork {
  readonly #rows = new Map<string, Bot>();

  run<T>(ws: WorkspaceId, fn: (ctx: BotTxContext) => Promise<T>): Promise<T> {
    const rows = this.#rows;
    const mine = (b: Bot) => b.snapshot().workspaceId === ws;
    return fn({
      bots: {
        list: async () => [...rows.values()].filter(mine),
        findById: async (id) => {
          const b = rows.get(id);
          return b && mine(b) ? b : null;
        },
        save: async (b) => {
          rows.set(b.id, b);
        },
      },
    });
  }
}
