import type {
  CreateTrainingItemRequest,
  TrainingChange,
  TrainingHistoryDto,
  TrainingItemDto,
  UpdateTrainingItemRequest,
} from '@agent-sales/contracts';
import { DomainError, isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { starterRuleRequests } from '../domain/starter-rules.js';
import type { ExternalTrainingChange, TrainingFacade } from '../api/training.facade.js';
import {
  TRAINING_UOW,
  type TrainingHistoryRecord,
  type TrainingRepository,
  type TrainingUnitOfWork,
} from './ports/training-unit-of-work.js';

class TrainingNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
}
class InvalidTrainingItemError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}
const notFound = (what = 'Training item') => new TrainingNotFoundError(`${what} not found`);
function missing(what?: string): never {
  throw notFound(what);
}

const ITEM_FIELDS = [
  'title',
  'content',
  'trigger',
  'notes',
  'mediaUrl',
  'folderId',
  'enabled',
  'section',
] as const;
function diff(before: TrainingItemDto, after: TrainingItemDto): TrainingChange[] {
  return ITEM_FIELDS.filter((f) => (before[f] ?? null) !== (after[f] ?? null)).map((field) => ({
    field,
    before: before[field] ?? null,
    after: after[field] ?? null,
  }));
}
function event(
  item: TrainingItemDto,
  action: TrainingHistoryDto['action'],
  actor: string,
  snapshot: TrainingItemDto | null,
  changes: TrainingChange[] = [],
): TrainingHistoryRecord {
  return {
    id: newId(),
    botId: item.botId,
    itemId: item.id,
    title: item.title,
    kind: item.kind,
    action,
    actor,
    changes,
    snapshot,
    createdAt: new Date().toISOString(),
  };
}
/** Settings entries need field changes to restore; items need the state before (or a creation). */
function toDto({ snapshot, ...entry }: TrainingHistoryRecord): TrainingHistoryDto {
  const restorable =
    entry.kind === 'settings'
      ? entry.changes.length > 0
      : entry.kind !== 'faq' && (entry.action === 'created' || snapshot !== null);
  return { ...entry, restorable };
}

/** Deletes and records an item; a folder's media are deleted (and recorded) first. */
async function remove(repo: TrainingRepository, item: TrainingItemDto, actor: string) {
  if (item.kind === 'media_folder')
    for (const child of (await repo.list(item.botId)).filter((i) => i.folderId === item.id)) {
      await repo.delete(item.botId, child.id);
      // Restoring it later puts it back outside any folder; the folder may be gone.
      await repo.record(event(child, 'deleted', actor, { ...child, folderId: null }));
    }
  await repo.delete(item.botId, item.id);
  await repo.record(event(item, 'deleted', actor, item));
}

@Injectable()
export class TrainingFacadeImpl implements TrainingFacade {
  constructor(@Inject(TRAINING_UOW) private readonly uow: TrainingUnitOfWork) {}
  list(ws: WorkspaceId, botId: string): Promise<TrainingItemDto[]> {
    return this.uow.run(ws, (repo) => repo.list(botId));
  }
  /** Folders hold media only; a media item may only point at a folder of the same bot. */
  private async checkFolder(
    repo: TrainingRepository,
    botId: string,
    kind: TrainingItemDto['kind'],
    item: Pick<TrainingItemDto, 'folderId' | 'mediaUrl'>,
  ): Promise<void> {
    if (kind === 'media_folder' && item.mediaUrl)
      throw new InvalidTrainingItemError('A media folder has no media URL');
    if (!item.folderId) return;
    if (kind !== 'media') throw new InvalidTrainingItemError('Only media can be put in a folder');
    const folder = await repo.find(botId, item.folderId);
    if (folder?.kind !== 'media_folder') missing('Media folder');
  }
  create(
    ws: WorkspaceId,
    botId: string,
    input: CreateTrainingItemRequest,
    actor = '',
  ): Promise<TrainingItemDto> {
    return this.uow.run(ws, async (repo) => {
      await this.checkFolder(repo, botId, input.kind, input);
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
      await repo.record(event(item, 'created', actor, null));
      return item;
    });
  }
  update(
    ws: WorkspaceId,
    botId: string,
    itemId: string,
    input: UpdateTrainingItemRequest,
    actor = '',
  ): Promise<TrainingItemDto> {
    if (!isUuid(itemId)) return Promise.reject(notFound());
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
        folderId: input.folderId === undefined ? current.folderId : input.folderId,
        enabled: input.enabled ?? current.enabled,
        section: input.section ?? current.section,
        updatedAt: new Date().toISOString(),
      };
      await this.checkFolder(repo, botId, item.kind, item);
      await repo.save(item);
      await repo.record(event(item, 'updated', actor, current, diff(current, item)));
      return item;
    });
  }
  /** Adds the starter rules whose exact title the bot does not have yet; returns the new ones. */
  seedStarterRules(
    ws: WorkspaceId,
    botId: string,
    actor = '',
    options: { recordHistory?: boolean } = {},
  ): Promise<TrainingItemDto[]> {
    return this.uow.run(ws, async (repo) => {
      await repo.lockBot(botId);
      const titles = new Set(await repo.scenarioTitles(botId));
      const created: TrainingItemDto[] = [];
      for (const request of starterRuleRequests()) {
        if (titles.has(request.title)) continue;
        const now = new Date().toISOString();
        const item: TrainingItemDto = {
          ...request,
          notes: '',
          id: newId(),
          botId,
          createdAt: now,
          updatedAt: now,
        };
        await repo.save(item);
        if (options.recordHistory !== false) await repo.record(event(item, 'created', actor, null));
        created.push(item);
      }
      return created;
    });
  }
  delete(ws: WorkspaceId, botId: string, itemId: string, actor = ''): Promise<void> {
    if (!isUuid(itemId)) return Promise.reject(notFound());
    return this.uow.run(ws, async (repo) => {
      const item = await repo.find(botId, itemId);
      if (!item) return missing();
      await remove(repo, item, actor);
    });
  }
  recordChanges(
    ws: WorkspaceId,
    botId: string,
    changes: ExternalTrainingChange[],
    actor = '',
  ): Promise<void> {
    return this.uow.run(ws, async (repo) => {
      for (const change of changes)
        await repo.record({
          ...change,
          changes: change.changes ?? [],
          actor,
          snapshot: null,
          id: newId(),
          botId,
          createdAt: new Date().toISOString(),
        });
    });
  }
  recordChange(
    ws: WorkspaceId,
    botId: string,
    change: ExternalTrainingChange,
    actor = '',
  ): Promise<void> {
    return this.recordChanges(ws, botId, [change], actor);
  }
  history(ws: WorkspaceId, botId: string): Promise<TrainingHistoryDto[]> {
    return this.uow.run(ws, async (repo) => (await repo.history(botId)).map(toDto));
  }
  historyEntry(ws: WorkspaceId, botId: string, id: string): Promise<TrainingHistoryDto | null> {
    if (!isUuid(id)) return Promise.resolve(null);
    return this.uow.run(ws, async (repo) => {
      const entry = await repo.findHistory(botId, id);
      return entry ? toDto(entry) : null;
    });
  }
  restoreItem(ws: WorkspaceId, botId: string, historyId: string, actor = ''): Promise<void> {
    if (!isUuid(historyId)) return Promise.reject(notFound('History entry'));
    return this.uow.run(ws, async (repo) => {
      const entry = await repo.findHistory(botId, historyId);
      if (!entry) return missing('History entry');
      if (!toDto(entry).restorable || entry.kind === 'settings' || entry.kind === 'faq')
        throw new InvalidTrainingItemError('This change cannot be restored here');
      const current = await repo.find(botId, entry.itemId);
      if (entry.action === 'created') {
        if (current) await remove(repo, current, actor); // already gone: nothing to undo
        return;
      }
      const snapshot = entry.snapshot;
      if (!snapshot) return missing('History snapshot');
      const folder = snapshot.folderId ? await repo.find(botId, snapshot.folderId) : null;
      const restored: TrainingItemDto = {
        ...snapshot,
        folderId: folder ? snapshot.folderId : null,
        updatedAt: new Date().toISOString(),
      };
      await repo.save(restored);
      await repo.record(
        current
          ? event(restored, 'updated', actor, current, diff(current, restored))
          : event(restored, 'created', actor, null),
      );
    });
  }
}
