import type { TrainingHistoryDto, TrainingItemDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

export interface TrainingRepository {
  list(botId: string): Promise<TrainingItemDto[]>;
  find(botId: string, itemId: string): Promise<TrainingItemDto | null>;
  save(item: TrainingItemDto): Promise<void>;
  delete(botId: string, itemId: string): Promise<void>;
  record(event: TrainingHistoryDto): Promise<void>;
  history(botId: string): Promise<TrainingHistoryDto[]>;
}
export interface TrainingUnitOfWork {
  run<T>(ws: WorkspaceId, fn: (repository: TrainingRepository) => Promise<T>): Promise<T>;
}
export const TRAINING_UOW = Symbol('TRAINING_UOW');
