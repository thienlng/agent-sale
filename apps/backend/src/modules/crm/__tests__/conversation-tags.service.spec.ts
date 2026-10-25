import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { ConversationTagsService } from '../application/conversation-tags.service.js';
import type {
  AssignmentRecord,
  CrmStore,
  CrmTx,
  TagRecord,
} from '../application/ports/crm-store.js';

const ws = workspaceId('018d0000-0000-7000-8000-000000000001');
const actor = '018d0000-0000-7000-8000-000000000009';
const conv = (n: number) => `018d0000-0000-7000-8000-00000000010${n}`;
const tagId = (n: number) => `018d0000-0000-7000-8000-00000000020${n}`;

function tag(n: number, over: Partial<TagRecord> = {}): TagRecord {
  return {
    id: tagId(n),
    name: `Tag ${n}`,
    color: '#ff6a00',
    type: 'classification',
    description: '',
    fields: [],
    schemaVersion: 1,
    isSystem: false,
    key: null,
    createdByUserId: null,
    createdByName: null,
    version: 1,
    archivedAt: null,
    updatedAt: new Date(0),
    ...over,
  };
}

/** Just the tables ConversationTagsService touches. */
function setup(tags: TagRecord[]) {
  const rows: AssignmentRecord[] = [];
  const tx = {
    tags: { find: async (id: string) => tags.find((t) => t.id === id) ?? null },
    assignments: {
      listFor: async (scope: string, ids: string[], withRemoved: boolean) =>
        rows.filter(
          (a) => a.scope === scope && ids.includes(a.entityId) && (withRemoved || !a.removedAt),
        ),
      findActive: async (tagId: string, scope: string, entityId: string) =>
        rows.find(
          (a) => a.tagId === tagId && a.scope === scope && a.entityId === entityId && !a.removedAt,
        ) ?? null,
      insert: async (_ws: string, a: AssignmentRecord) => {
        if (
          a.tagType !== 'work' &&
          rows.some((r) => r.tagId === a.tagId && r.entityId === a.entityId && !r.removedAt)
        )
          return false;
        rows.push(a);
        return true;
      },
      activePairs: async (
        scope: string,
        f: { entityIds?: readonly string[]; tagIds?: readonly string[] },
      ) =>
        rows
          .filter((a) => a.scope === scope && !a.removedAt)
          .filter((a) => !f.entityIds || f.entityIds.includes(a.entityId))
          .filter((a) => !f.tagIds || f.tagIds.includes(a.tagId))
          .flatMap((a) => {
            const t = tags.find((x) => x.id === a.tagId);
            return t && !t.archivedAt
              ? [{ entityId: a.entityId, tagId: t.id, tagName: t.name, tagColor: t.color }]
              : [];
          }),
    },
  } as unknown as CrmTx;
  const store: CrmStore = { run: (_ws, fn) => fn(tx) };
  const identity = { displayName: vi.fn(async () => 'Lan'), profile: vi.fn() };
  return { rows, service: new ConversationTagsService(store, identity as never) };
}

describe('ConversationTagsService', () => {
  it('assigns once per tag, records who, and answers the same assignment on a retry', async () => {
    const { service, rows } = setup([tag(1)]);
    const first = await service.assign(ws, conv(1), { tagId: tagId(1) }, actor);
    const again = await service.assign(ws, conv(1), { tagId: tagId(1) }, actor);
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, assignment: { id: first.assignment.id } });
    expect(first.assignment).toMatchObject({
      scope: 'conversation',
      assignedByName: 'Lan',
      tag: { id: tagId(1), name: 'Tag 1', color: '#ff6a00' },
    });
    expect(rows).toHaveLength(1);
  });

  it('rejects unknown and archived tags', async () => {
    const { service } = setup([tag(1, { archivedAt: new Date() })]);
    await expect(service.assign(ws, conv(1), { tagId: tagId(1) }, actor)).rejects.toThrow();
    await expect(service.assign(ws, conv(1), { tagId: tagId(2) }, actor)).rejects.toThrow();
    await expect(service.assign(ws, conv(1), { tagId: 'nope' }, actor)).rejects.toThrow();
  });

  it('returns chips per conversation, oldest first, hiding archived tags', async () => {
    const archived = tag(3, { archivedAt: new Date() });
    const { service, rows } = setup([tag(1), tag(2), archived]);
    await service.assign(ws, conv(1), { tagId: tagId(1) }, actor);
    await service.assign(ws, conv(1), { tagId: tagId(2) }, actor);
    await service.assign(ws, conv(2), { tagId: tagId(2) }, actor);
    rows.push({ ...rows[0]!, id: 'x', tagId: archived.id, entityId: conv(2) });
    const chips = await service.chips(ws, [conv(1), conv(2), conv(3)]);
    expect(chips.get(conv(1))?.map((c) => c.name)).toEqual(['Tag 1', 'Tag 2']);
    expect(chips.get(conv(2))?.map((c) => c.name)).toEqual(['Tag 2']);
    expect(chips.has(conv(3))).toBe(false);
    expect((await service.list(ws, conv(2))).map((a) => a.tag.name)).toEqual(['Tag 2']);
  });

  it('answers tag conditions with id sets for the inbox', async () => {
    const { service } = setup([tag(1), tag(2)]);
    await service.assign(ws, conv(1), { tagId: tagId(1) }, actor);
    await service.assign(ws, conv(1), { tagId: tagId(2) }, actor);
    await service.assign(ws, conv(2), { tagId: tagId(1) }, actor);
    const sorted = (r: { include: string[] | null; exclude: string[] }) => ({
      include: r.include?.sort() ?? null,
      exclude: r.exclude.sort(),
    });
    expect(sorted(await service.idsByTags(ws, { any: [tagId(1)] }))).toEqual({
      include: [conv(1), conv(2)],
      exclude: [],
    });
    expect(sorted(await service.idsByTags(ws, { all: [tagId(1), tagId(2)] }))).toEqual({
      include: [conv(1)],
      exclude: [],
    });
    expect(sorted(await service.idsByTags(ws, { exclude: [tagId(2)] }))).toEqual({
      include: null,
      exclude: [conv(1)],
    });
    expect(sorted(await service.idsByTags(ws, { untagged: true }))).toEqual({
      include: null,
      exclude: [conv(1), conv(2)],
    });
    expect(await service.idsByTags(ws, {})).toEqual({ include: null, exclude: [] });
  });
});
