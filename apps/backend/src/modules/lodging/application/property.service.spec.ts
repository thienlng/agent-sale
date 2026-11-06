import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { LodgingError } from '../domain/lodging.errors.js';
import type { LodgingAccess } from './lodging-access.js';
import type { LodgingStore } from './ports/lodging-store.js';
import { PropertyService } from './property.service.js';

describe('PropertyService.create', () => {
  it('reports an invalid property as VALIDATION_FAILED, not a raw ZodError', async () => {
    const run = vi.fn();
    const service = new PropertyService(
      { run } as unknown as LodgingStore,
      {
        assertHotel: () => Promise.resolve(),
      } as unknown as LodgingAccess,
    );
    const bad = {
      code: 'A17',
      name: 'Villa',
      sellMode: 'whole',
      childFreeBelow: 12,
      childAdultFrom: 6,
    };
    const err = await service
      .create(workspaceId('01890000-0000-7000-8000-000000000001'), bad as never, 'actor')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LodgingError);
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('PropertyService gallery ownership', () => {
  const ws = workspaceId('01890000-0000-7000-8000-000000000001');
  const other = '01890000-0000-7000-8000-000000000009';
  const file = '01890000-0000-7000-8000-0000000000aa.jpg';
  const clip = '01890000-0000-7000-8000-0000000000bb.mp4';
  const create = (item: { kind: string; url: string }, extra: object = {}) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const service = new PropertyService(
      { run } as unknown as LodgingStore,
      { assertHotel: () => Promise.resolve() } as unknown as LodgingAccess,
    );
    const input = {
      code: 'A20',
      name: 'Villa',
      sellMode: 'whole',
      standardAdults: 2,
      standardChildren: 0,
      gallery: [{ id: 'f1', name: 'Ảnh', items: [{ ...item, caption: '' }] }],
      ...extra,
    };
    return { run, done: service.create(ws, input as never, 'actor').catch((e: unknown) => e) };
  };

  it('refuses a Rapiz photo of another workspace, relative or on any host', async () => {
    for (const url of [
      `/media/products/${other}/${file}`,
      `https://old.trycloudflare.com/media/products/${other}/${file}`,
      `/media/workspaces/${ws}/bots/${other}/${file}`,
    ]) {
      const { run, done } = create({ kind: 'image', url });
      expect(await done, url).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'IMAGE_NOT_UPLOADED', field: 'gallery[0].items[0].url' },
      });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('accepts its own photos, external https photos, its own videos and video links', async () => {
    for (const item of [
      { kind: 'image', url: `/media/products/${ws}/${file}` },
      { kind: 'image', url: `https://old.trycloudflare.com/media/products/${ws}/${file}` },
      { kind: 'image', url: 'https://cdn.shop.vn/media/products/villa-1.jpg' },
      { kind: 'video', url: `/media/lodging/${ws}/${clip}` },
      { kind: 'link', url: 'https://youtu.be/abc' },
    ]) {
      const { run, done } = create(item);
      await done;
      expect(run, item.url).toHaveBeenCalled();
    }
  });

  it('refuses a video uploaded by another workspace', async () => {
    const { run, done } = create({ kind: 'video', url: `/media/lodging/${other}/${clip}` });
    expect(await done).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'VIDEO_NOT_UPLOADED', field: 'gallery[0].items[0].url' },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a cover that is not an image of the gallery', async () => {
    const { run, done } = create(
      { kind: 'image', url: `/media/products/${ws}/${file}` },
      { galleryCover: 'https://cdn.example.com/other.jpg' },
    );
    expect(await done).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(run).not.toHaveBeenCalled();
  });
});
