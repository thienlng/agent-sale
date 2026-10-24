import type { ContactFilter, ContactSort } from '@agent-sales/contracts';
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  or,
  schema,
  sql,
  type TenantTx,
  writeOutbox,
} from '@agent-sales/db';
import { newId, type WorkspaceId } from '@agent-sales/shared';

import type {
  AssignmentRecord,
  CrmTx,
  OptionKind,
  TagRecord,
  ViewRecord,
} from '../../application/ports/crm-store.js';
import { DuplicateTagNameError } from '../../domain/crm.errors.js';
import type { TagField } from '../../domain/tag-values.js';

const table = (kind: OptionKind) => (kind === 'source' ? schema.crmSources : schema.crmStatuses);
const t = schema.crmTags;
const a = schema.crmTagAssignments;
const v = schema.savedViews;

const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;

function toTag(r: typeof t.$inferSelect): TagRecord {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    type: r.type as TagRecord['type'],
    description: r.description,
    fields: r.fields as TagField[],
    schemaVersion: r.schemaVersion,
    isSystem: r.isSystem,
    key: r.key,
    createdByUserId: r.createdByUserId,
    createdByName: r.createdByName,
    version: r.version,
    archivedAt: r.archivedAt,
    updatedAt: r.updatedAt,
  };
}

const toAssignment = (r: typeof a.$inferSelect): AssignmentRecord => ({
  ...r,
  scope: r.scope as AssignmentRecord['scope'],
});

const toView = (r: typeof v.$inferSelect): ViewRecord => ({
  id: r.id,
  ownerUserId: r.ownerUserId,
  ownerName: r.ownerName,
  name: r.name,
  visibility: r.visibility as ViewRecord['visibility'],
  q: r.q,
  filter: r.filter as ContactFilter,
  sort: r.sort as ContactSort,
  columns: r.columns,
  version: r.version,
  updatedAt: r.updatedAt,
});

/** Sources, statuses, tags, assignments, saved views and the outbox in one tenant transaction. */
export function crmSettingsTx(
  ws: WorkspaceId,
  tx: TenantTx,
): Pick<CrmTx, 'options' | 'tags' | 'assignments' | 'views' | 'outbox'> {
  return {
    options: {
      async ensureDefaults(workspaceId, kind, defaults) {
        const o = table(kind);
        await tx
          .insert(o)
          .values(defaults.map((d, position) => ({ id: newId(), workspaceId, ...d, position })))
          .onConflictDoNothing({ target: [o.workspaceId, o.key], where: sql`key is not null` });
      },
      async list(kind) {
        const o = table(kind);
        return tx.select().from(o).orderBy(asc(o.position), asc(o.createdAt));
      },
      async find(kind, id) {
        const o = table(kind);
        const [r] = await tx.select().from(o).where(eq(o.id, id)).limit(1);
        return r ?? null;
      },
      async insert(workspaceId, kind, rec) {
        await tx.insert(table(kind)).values({ ...rec, workspaceId });
      },
      async update(kind, rec) {
        const o = table(kind);
        const { id, ...rest } = rec;
        await tx
          .update(o)
          .set({ ...rest, updatedAt: new Date() })
          .where(eq(o.id, id));
      },
    },

    tags: {
      async ensureDefaults(workspaceId, defaults) {
        await tx
          .insert(t)
          .values(
            defaults.map((d) => ({
              id: newId(),
              workspaceId,
              ...d,
              isSystem: true,
              createdByName: null,
            })),
          )
          .onConflictDoNothing({ target: [t.workspaceId, t.key], where: sql`key is not null` });
      },
      async list() {
        const rows = await tx
          .select({
            tag: t,
            // Spelled out with an alias: inside a select list Drizzle leaves columns
            // unqualified, which would compare the assignment with itself.
            activeCount: sql<number>`(select count(*) from crm_tag_assignments ta
              join contacts ct on ct.id = ta.entity_id and ct.archived_at is null
              where ta.tag_id = crm_tags.id and ta.removed_at is null and ta.scope = 'contact')`,
          })
          .from(t)
          // Active tags first (NULL archived_at), then archived ones.
          .orderBy(sql`${t.archivedAt} asc nulls first`, asc(t.createdAt));
        return rows.map((r) => ({ ...toTag(r.tag), activeCount: Number(r.activeCount) }));
      },
      async find(id, opts) {
        const q = tx.select().from(t).where(eq(t.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toTag(r) : null;
      },
      async insert(workspaceId, rec) {
        try {
          await tx.insert(t).values({ ...rec, workspaceId });
        } catch (e) {
          if (pgCode(e) === '23505') throw new DuplicateTagNameError(rec.name);
          throw e;
        }
      },
      async update(rec) {
        const { id, ...rest } = rec;
        try {
          await tx.update(t).set(rest).where(eq(t.id, id));
        } catch (e) {
          if (pgCode(e) === '23505') throw new DuplicateTagNameError(rec.name);
          throw e;
        }
      },
    },

    assignments: {
      async listFor(scope, entityIds, includeRemoved) {
        if (!entityIds.length) return [];
        const rows = await tx
          .select()
          .from(a)
          .where(
            and(
              eq(a.scope, scope),
              inArray(a.entityId, entityIds),
              includeRemoved ? undefined : isNull(a.removedAt),
            ),
          )
          .orderBy(asc(a.assignedAt), asc(a.id));
        return rows.map(toAssignment);
      },
      async findActive(tagId, scope, entityId) {
        const [r] = await tx
          .select()
          .from(a)
          .where(
            and(
              eq(a.tagId, tagId),
              eq(a.scope, scope),
              eq(a.entityId, entityId),
              isNull(a.removedAt),
            ),
          )
          .limit(1);
        return r ? toAssignment(r) : null;
      },
      async find(id, opts) {
        const q = tx.select().from(a).where(eq(a.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toAssignment(r) : null;
      },
      async insert(workspaceId, rec) {
        // A savepoint, so a lost race (unique violation) leaves the transaction usable.
        try {
          await tx.transaction(async (sp) => {
            await sp.insert(a).values({ ...rec, workspaceId });
          });
          return true;
        } catch (e) {
          if (pgCode(e) === '23505') return false;
          throw e;
        }
      },
      async update(rec) {
        const { id, ...rest } = rec;
        await tx.update(a).set(rest).where(eq(a.id, id));
      },
    },

    views: {
      async list(userId) {
        const rows = await tx
          .select()
          .from(v)
          .where(
            and(eq(v.entity, 'contact'), or(eq(v.visibility, 'shared'), eq(v.ownerUserId, userId))),
          )
          .orderBy(asc(v.name), asc(v.id));
        return rows.map(toView);
      },
      async find(id, opts) {
        const q = tx.select().from(v).where(eq(v.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toView(r) : null;
      },
      async insert(workspaceId, rec) {
        await tx.insert(v).values({ ...rec, workspaceId, entity: 'contact' });
      },
      async update(rec) {
        const { id, ...rest } = rec;
        await tx.update(v).set(rest).where(eq(v.id, id));
      },
      async delete(id) {
        await tx.delete(v).where(eq(v.id, id));
      },
    },

    async outbox(workspaceId, e) {
      await writeOutbox(tx, {
        workspaceId,
        type: e.type,
        aggregateType: 'contact',
        aggregateId: e.aggregateId,
        payload: e.payload,
      });
    },
  };
}
