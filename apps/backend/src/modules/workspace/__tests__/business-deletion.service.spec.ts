import { newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceLifecycle } from '../api/workspace-lifecycle.js';
import { BusinessDeletionService } from '../application/business-deletion.service.js';
import {
  BusinessNameMismatchError,
  BusinessNotActiveError,
  BusinessNotDeletedError,
  NotBusinessOwnerError,
  RestoreWindowClosedError,
  WorkspaceNotFoundError,
} from '../domain/workspace.errors.js';
import { Workspace } from '../domain/workspace.js';
import { InMemoryWorkspaceDirectory } from '../infrastructure/workspace.directory.js';
import { InMemoryWorkspaceUnitOfWork } from '../infrastructure/workspace.unit-of-work.js';

const DAY = 86_400_000;
const owner = userId(newId());
const admin = userId(newId());
const stranger = userId(newId());

async function setup(start = new Date('2026-11-12T03:00:00Z')) {
  const store = new InMemoryWorkspaceUnitOfWork();
  const directory = new InMemoryWorkspaceDirectory(store);
  const lifecycle = new WorkspaceLifecycle();
  const hook = vi.fn(async (_ws: WorkspaceId) => undefined);
  lifecycle.onDeletionRequested('channel', hook);
  let now = start;
  const clock = () => now;
  const service = new BusinessDeletionService(store, directory, lifecycle, clock);
  const ws = Workspace.create({
    name: 'Tiệm Hoa Mai',
    industry: 'retail',
    ownerUserId: owner,
    accountId: newId(),
  });
  await store.workspaces.save(ws);
  for (const [user, role] of [
    [owner, 'owner'],
    [admin, 'admin'],
  ] as const)
    await store.members.add({
      id: newId(),
      workspaceId: ws.id,
      userId: user,
      role,
      status: 'active',
    });
  return {
    store,
    directory,
    lifecycle,
    hook,
    service,
    ws: ws.id,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const asOwner = { userId: owner, name: 'Owner' };

describe('BusinessDeletionService', () => {
  it('lets the owner delete a business by typing its name: hidden, inactive, restorable for 30 days', async () => {
    const t = await setup();
    const deleted = await t.service.requestDeletion(t.ws, asOwner, '  Tiệm Hoa Mai ');
    expect(deleted.purgeAfter).toBe(
      new Date(Date.parse(deleted.deletedAt) + 30 * DAY).toISOString(),
    );
    expect(await t.directory.isActive(t.ws)).toBe(false);
    expect(await t.directory.findMembership(t.ws, owner)).toBeNull();
    expect(await t.directory.findMembership(t.ws, admin)).toBeNull();
    expect(await t.directory.listMemberships(admin)).toEqual([]);
    expect((await t.service.listDeleted(owner)).map((d) => d.workspaceId)).toEqual([t.ws]);
    expect(await t.service.listDeleted(admin)).toEqual([]);
    expect(t.store.audit.events.map((e) => e.action)).toEqual(['workspace.deletion_requested']);
    expect(t.store.events.published.map((e) => e.event.type)).toContain(
      'workspace.workspace.deletion_requested.v1',
    );
    expect(t.hook).toHaveBeenCalledWith(t.ws);
  });

  it('accepts the name typed with decomposed accents or doubled spaces (Vietnamese input methods)', async () => {
    const t = await setup();
    await t.service.requestDeletion(t.ws, asOwner, 'Tiệm  Hoa Mai'.normalize('NFD'));
    expect(await t.directory.isActive(t.ws)).toBe(false);
  });

  it('refuses a name that is not exactly the business name', async () => {
    const t = await setup();
    await expect(t.service.requestDeletion(t.ws, asOwner, 'tiệm hoa mai')).rejects.toBeInstanceOf(
      BusinessNameMismatchError,
    );
    expect(await t.directory.isActive(t.ws)).toBe(true);
    expect(t.hook).not.toHaveBeenCalled();
  });

  it('is for the owner only: a member gets FORBIDDEN, anyone else NOT_FOUND', async () => {
    const t = await setup();
    await expect(
      t.service.requestDeletion(t.ws, { userId: admin, name: null }, 'Tiệm Hoa Mai'),
    ).rejects.toBeInstanceOf(NotBusinessOwnerError);
    await expect(
      t.service.requestDeletion(t.ws, { userId: stranger, name: null }, 'Tiệm Hoa Mai'),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(await t.directory.isActive(t.ws)).toBe(true);
  });

  it('cannot delete a business twice', async () => {
    const t = await setup();
    await t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai');
    await expect(t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai')).rejects.toBeInstanceOf(
      BusinessNotActiveError,
    );
  });

  it('still deletes when a lifecycle hook fails', async () => {
    const t = await setup();
    t.lifecycle.onDeletionRequested('integration', async () => {
      throw new Error('KiotViet down');
    });
    await t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai');
    expect(await t.directory.isActive(t.ws)).toBe(false);
    expect(t.hook).toHaveBeenCalled();
  });

  it('restores within the window: active again and back in the lists', async () => {
    const t = await setup();
    await t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai');
    t.advance(29 * DAY);
    const restored = await t.service.restore(t.ws, asOwner);
    expect(restored.id).toBe(t.ws);
    expect(await t.directory.isActive(t.ws)).toBe(true);
    expect(await t.directory.findMembership(t.ws, admin)).not.toBeNull();
    expect(await t.service.listDeleted(owner)).toEqual([]);
    expect(t.store.audit.events.map((e) => e.action)).toEqual([
      'workspace.deletion_requested',
      'workspace.restored',
    ]);
    expect(t.store.events.published.map((e) => e.event.type)).toContain(
      'workspace.workspace.restored.v1',
    );
  });

  it('refuses a restore after the window, by a non-owner, or of an active business', async () => {
    const t = await setup();
    await expect(t.service.restore(t.ws, asOwner)).rejects.toBeInstanceOf(BusinessNotDeletedError);
    await t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai');
    await expect(t.service.restore(t.ws, { userId: admin, name: null })).rejects.toBeInstanceOf(
      NotBusinessOwnerError,
    );
    await expect(t.service.restore(t.ws, { userId: stranger, name: null })).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
    t.advance(30 * DAY);
    await expect(t.service.restore(t.ws, asOwner)).rejects.toBeInstanceOf(RestoreWindowClosedError);
    expect(await t.directory.isActive(t.ws)).toBe(false);
  });

  it('refuses a restore once the purge claimed the business, even inside the window', async () => {
    const t = await setup();
    await t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai');
    const claimed = (await t.store.workspaces.findById(t.ws))?.snapshot();
    if (!claimed) throw new Error('missing');
    await t.store.workspaces.save(Workspace.rehydrate({ ...claimed, status: 'purging' }));
    t.advance(DAY);
    await expect(t.service.restore(t.ws, asOwner)).rejects.toBeInstanceOf(RestoreWindowClosedError);
    expect(await t.directory.isActive(t.ws)).toBe(false);
    expect(await t.service.listDeleted(owner)).toEqual([]);
    expect(await t.directory.findMembership(t.ws, admin)).toBeNull();
    await expect(t.service.requestDeletion(t.ws, asOwner, 'Tiệm Hoa Mai')).rejects.toBeInstanceOf(
      BusinessNotActiveError,
    );
    expect(t.store.audit.events.map((e) => e.action)).toEqual(['workspace.deletion_requested']);
  });
});
