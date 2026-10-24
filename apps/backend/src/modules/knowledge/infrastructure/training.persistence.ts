import { and, type Database, desc, eq, schema, type TenantTx, withTenant } from '@agent-sales/db';
import { TrainingHistoryDto, TrainingItemDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type {
  TrainingHistoryRecord,
  TrainingRepository,
  TrainingUnitOfWork,
} from '../application/ports/training-unit-of-work.js';

const items = schema.trainingItems;
const history = schema.trainingHistory;
function itemDto(row: typeof items.$inferSelect): TrainingItemDto {
  return TrainingItemDto.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
function historyRecord(row: typeof history.$inferSelect): TrainingHistoryRecord {
  const { restorable: _derived, ...dto } = TrainingHistoryDto.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
  return { ...dto, snapshot: row.snapshot ? TrainingItemDto.parse(row.snapshot) : null };
}
class DrizzleTrainingRepository implements TrainingRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly ws: WorkspaceId,
  ) {}
  async list(botId: string): Promise<TrainingItemDto[]> {
    return (
      await this.tx
        .select()
        .from(items)
        .where(and(eq(items.workspaceId, this.ws), eq(items.botId, botId)))
        .orderBy(desc(items.updatedAt), desc(items.id))
        .limit(500)
    ).map(itemDto);
  }
  async find(botId: string, itemId: string): Promise<TrainingItemDto | null> {
    const [row] = await this.tx
      .select()
      .from(items)
      .where(and(eq(items.workspaceId, this.ws), eq(items.botId, botId), eq(items.id, itemId)))
      .limit(1);
    return row ? itemDto(row) : null;
  }
  async save(item: TrainingItemDto): Promise<void> {
    const row = {
      ...item,
      workspaceId: this.ws,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    };
    await this.tx
      .insert(items)
      .values(row)
      .onConflictDoUpdate({
        target: items.id,
        set: {
          title: item.title,
          content: item.content,
          trigger: item.trigger,
          notes: item.notes ?? '',
          mediaUrl: item.mediaUrl,
          folderId: item.folderId,
          updatedAt: row.updatedAt,
        },
      });
  }
  async delete(botId: string, itemId: string): Promise<void> {
    await this.tx
      .delete(items)
      .where(and(eq(items.workspaceId, this.ws), eq(items.botId, botId), eq(items.id, itemId)));
  }
  async record(event: TrainingHistoryRecord): Promise<void> {
    await this.tx
      .insert(history)
      .values({ ...event, workspaceId: this.ws, createdAt: new Date(event.createdAt) });
  }
  async history(botId: string): Promise<TrainingHistoryRecord[]> {
    return (
      await this.tx
        .select()
        .from(history)
        .where(and(eq(history.workspaceId, this.ws), eq(history.botId, botId)))
        .orderBy(desc(history.createdAt), desc(history.id))
        .limit(200)
    ).map(historyRecord);
  }
  async findHistory(botId: string, id: string): Promise<TrainingHistoryRecord | null> {
    const [row] = await this.tx
      .select()
      .from(history)
      .where(and(eq(history.workspaceId, this.ws), eq(history.botId, botId), eq(history.id, id)))
      .limit(1);
    return row ? historyRecord(row) : null;
  }
}
export class DrizzleTrainingUnitOfWork implements TrainingUnitOfWork {
  constructor(private readonly db: Database) {}
  run<T>(ws: WorkspaceId, fn: (repository: TrainingRepository) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) => fn(new DrizzleTrainingRepository(tx, ws)));
  }
}
export class InMemoryTrainingUnitOfWork implements TrainingUnitOfWork {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly partitions = new Map<
    string,
    { items: Map<string, TrainingItemDto>; history: TrainingHistoryRecord[] }
  >();
  async run<T>(ws: WorkspaceId, fn: (repository: TrainingRepository) => Promise<T>): Promise<T> {
    const previous = this.pending.get(ws) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => barrier);
    this.pending.set(ws, tail);
    await previous;
    try {
      const current = this.partitions.get(ws) ?? {
        items: new Map<string, TrainingItemDto>(),
        history: [],
      };
      const draft = structuredClone(current);
      const result = await fn({
        list: async (botId) =>
          [...draft.items.values()]
            .filter((item) => item.botId === botId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
            .slice(0, 500),
        find: async (botId, id) => {
          const item = draft.items.get(id);
          return item?.botId === botId ? item : null;
        },
        save: async (item) => {
          draft.items.set(item.id, item);
        },
        delete: async (_botId, id) => {
          draft.items.delete(id);
          // Mirrors the folder_id foreign key (on delete cascade).
          for (const item of draft.items.values())
            if (item.folderId === id) draft.items.delete(item.id);
        },
        record: async (event) => {
          draft.history.unshift(event);
        },
        history: async (botId) =>
          draft.history.filter((entry) => entry.botId === botId).slice(0, 200),
        findHistory: async (botId, id) =>
          draft.history.find((entry) => entry.botId === botId && entry.id === id) ?? null,
      });
      this.partitions.set(ws, draft);
      return result;
    } finally {
      release();
      if (this.pending.get(ws) === tail) this.pending.delete(ws);
    }
  }
}
