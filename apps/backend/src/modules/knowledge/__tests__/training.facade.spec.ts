import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';
import { STARTER_RULES } from '../domain/starter-rules.js';
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
  folderId: null,
  enabled: true,
  section: 'general' as const,
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

  it('keeps media in folders of the same bot and deletes them with their folder', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const folder = await facade.create(ws, bot, { ...input, kind: 'media_folder', title: 'Shoes' });
    const photo = await facade.create(ws, bot, {
      ...input,
      kind: 'media',
      mediaUrl: 'https://example.test/a.png',
      folderId: folder.id,
    });
    await expect(facade.create(ws, bot, { ...input, folderId: folder.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      facade.create(ws, bot, { ...input, kind: 'media', folderId: photo.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await facade.delete(ws, bot, folder.id, 'Ken');
    expect(await facade.list(ws, bot)).toEqual([]);
    const [folderEntry, photoEntry] = await facade.history(ws, bot);
    expect(folderEntry).toMatchObject({ itemId: folder.id, action: 'deleted', actor: 'Ken' });
    expect(photoEntry).toMatchObject({ itemId: photo.id, action: 'deleted', restorable: true });
    // The folder is gone, so the restored photo comes back outside any folder.
    await facade.restoreItem(ws, bot, photoEntry!.id, 'Ken');
    expect(await facade.list(ws, bot)).toMatchObject([{ id: photo.id, folderId: null }]);
  });

  it('records changed fields and restores the state before an edit or a creation', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const item = await facade.create(ws, bot, input, 'Ken');
    await facade.update(ws, bot, item.id, { title: 'Delivery policy' }, 'An');
    const [edit, creation] = await facade.history(ws, bot);
    expect(edit).toMatchObject({
      actor: 'An',
      restorable: true,
      changes: [{ field: 'title', before: 'Delivery question', after: 'Delivery policy' }],
    });
    await facade.restoreItem(ws, bot, edit!.id, 'Ken');
    expect((await facade.list(ws, bot))[0]?.title).toBe('Delivery question');
    await facade.restoreItem(ws, bot, creation!.id, 'Ken');
    expect(await facade.list(ws, bot)).toEqual([]);
    await facade.recordChange(ws, bot, {
      itemId: newId(),
      title: 'FAQ',
      kind: 'faq',
      action: 'deleted',
    });
    const [faq] = await facade.history(ws, bot);
    expect(faq?.restorable).toBe(false);
    await expect(facade.restoreItem(ws, bot, faq!.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('stores enabled and section, and shows a toggle and a move in the history', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const item = await facade.create(ws, bot, { ...input, section: 'after_order' });
    expect(item).toMatchObject({ enabled: true, section: 'after_order' });
    const off = await facade.update(ws, bot, item.id, { enabled: false });
    expect(off).toMatchObject({ enabled: false, section: 'after_order', content: input.content });
    await facade.update(ws, bot, item.id, { section: 'general' });
    const [moved, toggled] = await facade.history(ws, bot);
    expect(toggled?.changes).toEqual([{ field: 'enabled', before: true, after: false }]);
    expect(moved?.changes).toEqual([{ field: 'section', before: 'after_order', after: 'general' }]);
    expect((await facade.list(ws, bot))[0]).toMatchObject({ enabled: false, section: 'general' });
  });

  it('restores enabled and section from a history snapshot', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const item = await facade.create(ws, bot, { ...input, section: 'after_order' });
    await facade.update(ws, bot, item.id, { enabled: false, section: 'general' });
    const [entry] = await facade.history(ws, bot);
    await facade.restoreItem(ws, bot, entry?.id ?? '');
    expect((await facade.list(ws, bot))[0]).toMatchObject({
      enabled: true,
      section: 'after_order',
    });
  });

  it('seeds the starter rules once, records them and adds only missing titles', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const first = await facade.seedStarterRules(ws, bot);
    expect(first.length).toBe(STARTER_RULES.length);
    expect(first.every((i) => i.kind === 'scenario' && i.enabled)).toBe(true);
    expect(first.filter((i) => i.section === 'after_order')).toHaveLength(1);
    expect(await facade.history(ws, bot)).toHaveLength(first.length);
    expect(await facade.seedStarterRules(ws, bot)).toEqual([]);
    const removed = first.find((i) => i.title === 'Trả lời ngắn gọn');
    await facade.delete(ws, bot, removed?.id ?? '');
    expect((await facade.seedStarterRules(ws, bot)).map((i) => i.title)).toEqual([
      'Trả lời ngắn gọn',
    ]);
    expect(await facade.list(ws, bot)).toHaveLength(first.length);
    expect(await facade.seedStarterRules(ws, newId())).toHaveLength(first.length);
    expect(await facade.list(other, bot)).toEqual([]);
  });

  it('records no history when asked not to (bot creation seeds silently)', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const created = await facade.seedStarterRules(ws, bot, '', { recordHistory: false });
    expect(created).toHaveLength(STARTER_RULES.length);
    expect(await facade.history(ws, bot)).toEqual([]);
    expect(await facade.seedStarterRules(ws, bot)).toEqual([]);
  });

  it('does not duplicate rules when seeds run concurrently', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const results = await Promise.all([
      facade.seedStarterRules(ws, bot),
      facade.seedStarterRules(ws, bot),
    ]);
    expect(results.flat()).toHaveLength(STARTER_RULES.length);
    expect(await facade.list(ws, bot)).toHaveLength(STARTER_RULES.length);
  });

  it('sees every existing scenario title, not only the 500 newest', async () => {
    const facade = new TrainingFacadeImpl(new InMemoryTrainingUnitOfWork());
    const starter = STARTER_RULES[0]!;
    await facade.create(ws, bot, { ...input, title: starter.title });
    for (let i = 0; i < 500; i++) await facade.create(ws, bot, { ...input, title: `Rule ${i}` });
    expect(await facade.list(ws, bot)).toHaveLength(500);
    const created = await facade.seedStarterRules(ws, bot);
    expect(created.map((c) => c.title)).not.toContain(starter.title);
    expect(created).toHaveLength(STARTER_RULES.length - 1);
  });
});
