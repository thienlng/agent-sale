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
  const create = (url: string) => {
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
      gallery: [{ url, caption: '' }],
    };
    return { run, done: service.create(ws, input as never, 'actor').catch((e: unknown) => e) };
  };

  it('refuses a Rapiz photo of another workspace, relative or on any host', async () => {
    for (const url of [
      `/media/products/${other}/${file}`,
      `https://old.trycloudflare.com/media/products/${other}/${file}`,
      `/media/workspaces/${ws}/bots/${other}/${file}`,
    ]) {
      const { run, done } = create(url);
      expect(await done, url).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { reason: 'IMAGE_NOT_UPLOADED', field: 'gallery[0].url' },
      });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('accepts its own photos and external https links', async () => {
    for (const url of [
      `/media/products/${ws}/${file}`,
      `https://old.trycloudflare.com/media/products/${ws}/${file}`,
      'https://cdn.shop.vn/media/products/villa-1.jpg',
    ]) {
      const { run, done } = create(url);
      await done;
      expect(run, url).toHaveBeenCalled();
    }
  });
});
