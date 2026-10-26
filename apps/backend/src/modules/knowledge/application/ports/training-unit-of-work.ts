import type { TrainingHistoryDto, TrainingItemDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** A stored history entry: the DTO without the derived flag, plus the item before the change. */
export type TrainingHistoryRecord = Omit<TrainingHistoryDto, 'restorable'> & {
  snapshot: TrainingItemDto | null;
};

export interface TrainingRepository {
  list(botId: string): Promise<TrainingItemDto[]>;
  /** Every scenario title of the bot (no 500-row cap), for idempotent seeding. */
  scenarioTitles(botId: string): Promise<string[]>;
  /** Serializes concurrent writers of one bot until the transaction ends (advisory lock). */
  lockBot(botId: string): Promise<void>;
  find(botId: string, itemId: string): Promise<TrainingItemDto | null>;
  save(item: TrainingItemDto): Promise<void>;
  delete(botId: string, itemId: string): Promise<void>;
  record(event: TrainingHistoryRecord): Promise<void>;
  history(botId: string): Promise<TrainingHistoryRecord[]>;
  findHistory(botId: string, id: string): Promise<TrainingHistoryRecord | null>;
}
export interface TrainingUnitOfWork {
  run<T>(ws: WorkspaceId, fn: (repository: TrainingRepository) => Promise<T>): Promise<T>;
}
export const TRAINING_UOW = Symbol('TRAINING_UOW');
