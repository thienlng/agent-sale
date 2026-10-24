import type {
  CreateTrainingItemRequest,
  TrainingChange,
  TrainingItemDto,
  TrainingHistoryDto,
  UpdateTrainingItemRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** A change made outside training items (FAQs, bot settings) that the history must show. */
export interface ExternalTrainingChange {
  itemId: string;
  title: string;
  kind: 'faq' | 'settings';
  action: 'created' | 'updated' | 'deleted';
  changes?: TrainingChange[];
}

/**
 * The caller verifies bot ownership before invoking training operations.
 * `actor` is the display name recorded in the history ('' for system changes).
 */
export interface TrainingFacade {
  list(ws: WorkspaceId, botId: string): Promise<TrainingItemDto[]>;
  create(
    ws: WorkspaceId,
    botId: string,
    input: CreateTrainingItemRequest,
    actor?: string,
  ): Promise<TrainingItemDto>;
  update(
    ws: WorkspaceId,
    botId: string,
    itemId: string,
    input: UpdateTrainingItemRequest,
    actor?: string,
  ): Promise<TrainingItemDto>;
  /** Deleting a media folder deletes (and records) the media inside it first. */
  delete(ws: WorkspaceId, botId: string, itemId: string, actor?: string): Promise<void>;
  recordChanges(
    ws: WorkspaceId,
    botId: string,
    changes: ExternalTrainingChange[],
    actor?: string,
  ): Promise<void>;
  recordChange(
    ws: WorkspaceId,
    botId: string,
    change: ExternalTrainingChange,
    actor?: string,
  ): Promise<void>;
  history(ws: WorkspaceId, botId: string): Promise<TrainingHistoryDto[]>;
  historyEntry(ws: WorkspaceId, botId: string, id: string): Promise<TrainingHistoryDto | null>;
  /**
   * Puts a training item back as it was before the history entry (re-creates it after a
   * deletion, deletes it after a creation). Settings entries are restored by the bot module.
   */
  restoreItem(ws: WorkspaceId, botId: string, historyId: string, actor?: string): Promise<void>;
}
export const TRAINING_FACADE = Symbol('TRAINING_FACADE');
