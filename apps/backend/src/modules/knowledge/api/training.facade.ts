import type {
  CreateTrainingItemRequest,
  TrainingItemDto,
  TrainingHistoryDto,
  UpdateTrainingItemRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** The caller verifies bot ownership before invoking training operations. */
export interface TrainingFacade {
  list(ws: WorkspaceId, botId: string): Promise<TrainingItemDto[]>;
  create(
    ws: WorkspaceId,
    botId: string,
    input: CreateTrainingItemRequest,
  ): Promise<TrainingItemDto>;
  update(
    ws: WorkspaceId,
    botId: string,
    itemId: string,
    input: UpdateTrainingItemRequest,
  ): Promise<TrainingItemDto>;
  delete(ws: WorkspaceId, botId: string, itemId: string): Promise<void>;
  recordChanges(
    ws: WorkspaceId,
    botId: string,
    changes: Array<{
      itemId: string;
      title: string;
      kind: 'faq' | 'settings';
      action: 'created' | 'updated' | 'deleted';
    }>,
  ): Promise<void>;
  recordChange(
    ws: WorkspaceId,
    botId: string,
    change: {
      itemId: string;
      title: string;
      kind: 'faq' | 'settings';
      action: 'created' | 'updated' | 'deleted';
    },
  ): Promise<void>;
  history(ws: WorkspaceId, botId: string): Promise<TrainingHistoryDto[]>;
}
export const TRAINING_FACADE = Symbol('TRAINING_FACADE');
