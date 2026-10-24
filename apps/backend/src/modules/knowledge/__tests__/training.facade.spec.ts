import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';
import { TrainingFacadeImpl } from '../application/training.facade.impl.js';
import { InMemoryTrainingUnitOfWork } from '../infrastructure/training.persistence.js';

const ws = workspaceId(newId());
const other = workspaceId(newId());
const bot = newId();
const input = {
  kind: 'scenario' as const,
  title: 'Delivery question',
  content: 'Ask for the city first.',
  trigger: 'Delivery',
  mediaUrl: null,
};

describe('Training materials', () => {
  it('persists edits and preserves history after deletion within one workspace', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const item = await facade.create(ws, bot, input);
    expect(item.id[14]).toBe('7');
    expect(await facade.update(ws, bot, item.id, { title: 'Delivery policy' })).toMatchObject({
      title: 'Delivery policy',
      content: input.content,
    });
    await facade.delete(ws, bot, item.id);
    expect(await facade.list(ws, bot)).toEqual([]);
    expect((await facade.history(ws, bot)).map((entry) => entry.action)).toEqual([
      'deleted',
      'updated',
      'created',
    ]);
  });

  it('conceals materials and history from other workspaces and bots', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const item = await facade.create(ws, bot, input);
    expect(await facade.list(other, bot)).toEqual([]);
    expect(await facade.history(other, bot)).toEqual([]);
    await expect(facade.update(other, bot, item.id, { title: 'Leak' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(facade.delete(ws, newId(), item.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(facade.update(ws, bot, 'invalid', { title: 'Leak' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await facade.list(ws, bot))[0]?.title).toBe(input.title);
    const media = await facade.create(ws, bot, {
      ...input,
      kind: 'media',
      mediaUrl: 'https://example.test/photo.png',
      trigger: '@photo',
    });
    expect(await facade.update(ws, bot, media.id, { title: 'New photo title' })).toMatchObject({
      mediaUrl: media.mediaUrl,
      trigger: '@photo',
    });
  });

  it('retains simultaneous creates and rolls back a failed transaction', async () => {
    const uow = new InMemoryTrainingUnitOfWork();
    const facade = new TrainingFacadeImpl(uow);
    await Promise.all([
      facade.create(ws, bot, input),
      facade.create(ws, bot, { ...input, title: 'Returns' }),
    ]);
    expect(await facade.list(ws, bot)).toHaveLength(2);
    expect(await facade.history(ws, bot)).toHaveLength(2);
    await expect(
      uow.run(ws, async (repository) => {
        await repository.delete(bot, (await repository.list(bot))[0]?.id ?? '');
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await facade.list(ws, bot)).toHaveLength(2);
  });
});
