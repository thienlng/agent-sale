import type { WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { ProjectorService } from '../application/projector.service.js';
import type { FactDraft, OutboxRow } from '../domain/fact.js';
import type { FactStore, ProjectionLease, ProjectionStore } from '../domain/ports/projection.js';

const WS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d02';

const created = (id: number, workspaceId: string | null = WS): OutboxRow => ({
  id,
  workspaceId,
  type: 'crm.contact.created.v1',
  aggregateId: CONTACT,
  payload: {
    workspaceId: WS,
    contactId: CONTACT,
    actorUserId: null,
    occurredAt: '2026-10-20T03:00:00.000Z',
    sourceId: null,
  },
  createdAt: new Date('2026-10-24T08:00:00.000Z'),
});
const broken = (id: number): OutboxRow => ({
  ...created(id),
  type: 'crm.tag.assigned.v1',
  payload: { broken: true },
});

class Fakes implements ProjectionStore, FactStore {
  /** Everything up to this id is projected (the real store keeps a transaction horizon). */
  position = 0;
  outbox: OutboxRow[] = [];
  deadLetters: number[] = [];
  appended: FactDraft[] = [];
  busy = false;
  failAppend = false;
  failReplace = false;
  /** Called once per lease taken (to observe waiting). */
  leases = 0;

  async withLease<T>(fn: (l: ProjectionLease) => Promise<T | null>): Promise<T | null> {
    if (this.busy) return null;
    this.leases++;
    const window = this.outbox.filter((r) => r.id > this.position);
    return fn({
      readBatch: async (after, limit) => window.filter((r) => r.id > after).slice(0, limit),
      commit: async () => {
        this.position = window.reduce((max, r) => Math.max(max, r.id), this.position);
      },
      deadLetter: async (row) => {
        this.deadLetters.push(row.id);
      },
      readWorkspace: async (ws, after, limit) =>
        this.outbox.filter((r) => r.workspaceId === ws && r.id > after).slice(0, limit),
      replaceFacts: async (ws, facts) => {
        if (this.failReplace) throw new Error('db down');
        this.appended = [...this.appended.filter((f) => f.workspaceId !== ws), ...facts];
      },
    });
  }
  async health() {
    return { watermarkId: this.appended.length, watermarkAt: null, lagSeconds: 0 };
  }
  async append(_ws: WorkspaceId, facts: readonly FactDraft[]) {
    if (this.failAppend) throw new Error('db down');
    const fresh = facts.filter(
      (f) => !this.appended.some((a) => a.outboxId === f.outboxId && a.kind === f.kind),
    );
    this.appended.push(...fresh);
    return fresh.length;
  }
}

const setup = () => {
  const fakes = new Fakes();
  return { fakes, projector: new ProjectorService(fakes, fakes) };
};

describe('ProjectorService', () => {
  it('projects the pending events and moves the position', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1), created(2), created(3)];
    expect(await projector.tick()).toBe(3);
    expect(fakes.appended.map((f) => f.outboxId)).toEqual([1, 2, 3]);
    expect(fakes.position).toBe(3);
    expect(await projector.tick()).toBe(0);
  });

  it('a replay from the start adds nothing (idempotent)', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1), created(2)];
    await projector.tick();
    fakes.position = 0;
    await projector.tick();
    expect(fakes.appended).toHaveLength(2);
  });

  it('dead-letters a payload it cannot read and keeps going', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1), broken(2), created(3)];
    await projector.tick();
    expect(fakes.deadLetters).toEqual([2]);
    expect(fakes.appended.map((f) => f.outboxId)).toEqual([1, 3]);
    expect(fakes.position).toBe(3);
  });

  it('a database failure leaves the position where it was, so the pass is retried', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1)];
    fakes.failAppend = true;
    await expect(projector.tick()).rejects.toThrow('db down');
    expect(fakes.position).toBe(0);
    fakes.failAppend = false;
    expect(await projector.tick()).toBe(1);
    expect(fakes.position).toBe(1);
  });

  it('does nothing while another projector holds the lease', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1)];
    fakes.busy = true;
    expect(await projector.tick()).toBe(0);
    expect(fakes.appended).toEqual([]);
  });

  it('skips events without a workspace and still advances past them', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1, null), created(2)];
    await projector.tick();
    expect(fakes.appended.map((f) => f.outboxId)).toEqual([2]);
    expect(fakes.position).toBe(2);
  });

  it('one pass drains a window larger than a page', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = Array.from({ length: 1200 }, (_, i) => created(i + 1));
    expect(await projector.tick()).toBe(1200);
    expect(fakes.position).toBe(1200);
  });

  it('catchUp waits for a busy projector instead of reading around it', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1)];
    fakes.busy = true;
    setTimeout(() => {
      fakes.busy = false;
    }, 60);
    await projector.catchUp();
    // It returned only after the other projector was done, and ran its own pass.
    expect(fakes.position).toBe(1);
  });

  it('catchUp gives up after the wait and leaves the lag to be reported', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1)];
    fakes.busy = true;
    await projector.catchUp(60);
    expect(fakes.position).toBe(0);
  });
});

describe('ProjectorService.rebuild', () => {
  it('forgets the workspace facts and replays them to the same result', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1), created(2)];
    await projector.tick();
    const before = JSON.stringify(fakes.appended);
    expect(await projector.rebuild(WS as WorkspaceId)).toEqual({ events: 2, facts: 2 });
    expect(JSON.stringify(fakes.appended)).toBe(before);
  });

  it('is all or nothing: a failure keeps the facts it had', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1), created(2)];
    await projector.tick();
    fakes.failReplace = true;
    await expect(projector.rebuild(WS as WorkspaceId)).rejects.toThrow('db down');
    expect(fakes.appended).toHaveLength(2);
  });

  it('dead-letters events it cannot read, like the live projection does', async () => {
    const { fakes, projector } = setup();
    fakes.outbox = [created(1), broken(2)];
    expect(await projector.rebuild(WS as WorkspaceId)).toEqual({ events: 2, facts: 1 });
    expect(fakes.deadLetters).toEqual([2]);
  });

  it('refuses to run, rather than read around the projector, when it stays busy', async () => {
    const { fakes, projector } = setup();
    fakes.busy = true;
    await expect(projector.rebuild(WS as WorkspaceId, 150)).rejects.toThrow('busy');
  });
});
