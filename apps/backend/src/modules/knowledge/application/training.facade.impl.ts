import type {
  CreateTrainingItemRequest,
  TrainingHistoryDto,
  TrainingItemDto,
  UpdateTrainingItemRequest,
} from '@agent-sales/contracts';
import { DomainError, isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { TrainingFacade } from '../api/training.facade.js';
import { TRAINING_UOW, type TrainingUnitOfWork } from './ports/training-unit-of-work.js';

class TrainingItemNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Training item not found');
  }
}
function missing(): never {
  throw new TrainingItemNotFoundError();
}
function event(item: TrainingItemDto, action: TrainingHistoryDto['action']): TrainingHistoryDto {
  return {
    id: newId(),
    botId: item.botId,
    itemId: item.id,
    title: item.title,
    kind: item.kind,
    action,
    createdAt: new Date().toISOString(),
  };
}
@Injectable()
export class TrainingFacadeImpl implements TrainingFacade {
  constructor(@Inject(TRAINING_UOW) private readonly uow: TrainingUnitOfWork) {}
  list(ws: WorkspaceId, botId: string): Promise<TrainingItemDto[]> {
    return this.uow.run(ws, (repo) => repo.list(botId));
  }
  create(
    ws: WorkspaceId,
    botId: string,
    input: CreateTrainingItemRequest,
  ): Promise<TrainingItemDto> {
    return this.uow.run(ws, async (repo) => {
      const now = new Date().toISOString();
      const item = {
        ...input,
        notes: input.notes ?? '',
        id: newId(),
        botId,
        createdAt: now,
        updatedAt: now,
      };
      await repo.save(item);
      await repo.record(event(item, 'created'));
      return item;
    });
  }
  update(
    ws: WorkspaceId,
    botId: string,
    itemId: string,
    input: UpdateTrainingItemRequest,
  ): Promise<TrainingItemDto> {
    if (!isUuid(itemId)) return Promise.reject(new TrainingItemNotFoundError());
    return this.uow.run(ws, async (repo) => {
      const current = await repo.find(botId, itemId);
      if (!current) return missing();
      const item: TrainingItemDto = {
        ...current,
        title: input.title ?? current.title,
        content: input.content ?? current.content,
        trigger: input.trigger ?? current.trigger,
        notes: input.notes ?? current.notes ?? '',
        mediaUrl: input.mediaUrl === undefined ? current.mediaUrl : input.mediaUrl,
        updatedAt: new Date().toISOString(),
      };
      await repo.save(item);
      await repo.record(event(item, 'updated'));
      return item;
    });
  }
  delete(ws: WorkspaceId, botId: string, itemId: string): Promise<void> {
    if (!isUuid(itemId)) return Promise.reject(new TrainingItemNotFoundError());
    return this.uow.run(ws, async (repo) => {
      const item = await repo.find(botId, itemId);
      if (!item) return missing();
      await repo.delete(botId, itemId);
      await repo.record(event(item, 'deleted'));
    });
  }
  recordChanges(
    ws: WorkspaceId,
    botId: string,
    changes: Array<{
      itemId: string;
      title: string;
      kind: 'faq' | 'settings';
      action: 'created' | 'updated' | 'deleted';
    }>,
  ): Promise<void> {
    return this.uow.run(ws, async (repo) => {
      for (const change of changes)
        await repo.record({ ...change, id: newId(), botId, createdAt: new Date().toISOString() });
    });
  }
  recordChange(
    ws: WorkspaceId,
    botId: string,
    change: {
      itemId: string;
      title: string;
      kind: 'faq' | 'settings';
      action: 'created' | 'updated' | 'deleted';
    },
  ): Promise<void> {
    return this.recordChanges(ws, botId, [change]);
  }
  history(ws: WorkspaceId, botId: string): Promise<TrainingHistoryDto[]> {
    return this.uow.run(ws, (repo) => repo.history(botId));
  }
}
