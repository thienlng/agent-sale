import { StayRequestDto } from '@agent-sales/contracts';
import {
  and,
  asc,
  desc,
  eq,
  lt,
  gt,
  schema,
  sql,
  withTenant,
  writeAudit,
  type Database,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import type { LodgingStore, LodgingTx, StoredStay } from '../../application/ports/lodging-store.js';
import { LodgingError } from '../../domain/lodging.js';
import { toProduct, pgCode } from './commerce.rows.js';

const s = schema.stayRequests,
  p = schema.products;
function fromRow(r: typeof s.$inferSelect): StoredStay {
  return {
    ...StayRequestDto.parse({
      ...r,
      dates: { checkIn: r.checkIn, checkOut: r.checkOut },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }),
    fingerprint: r.fingerprint,
  };
}

export class DrizzleLodgingStore implements LodgingStore {
  constructor(private readonly db: Database) {}
  async run<T>(ws: WorkspaceId, fn: (tx: LodgingTx) => Promise<T>): Promise<T> {
    try {
      return await withTenant(this.db, ws, async (tx) => {
        const rowScope = (id: string) => and(eq(s.workspaceId, ws), eq(s.id, id));
        const port: LodgingTx = {
          async property(id, lock) {
            const q = tx
              .select()
              .from(p)
              .where(and(eq(p.workspaceId, ws), eq(p.id, id)))
              .limit(1);
            const [r] = await (lock ? q.for('update') : q);
            return r ? toProduct(r) : null;
          },
          async lockRequestKey(key) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`${ws}:${key}`}, 0))`,
            );
          },
          async find(id, lock) {
            const q = tx.select().from(s).where(rowScope(id)).limit(1);
            const [r] = await (lock ? q.for('update') : q);
            return r ? fromRow(r) : null;
          },
          async findRequest(key) {
            const [r] = await tx
              .select()
              .from(s)
              .where(and(eq(s.workspaceId, ws), eq(s.clientRequestId, key)))
              .limit(1);
            return r ? fromRow(r) : null;
          },
          async list(filter) {
            return (
              await tx
                .select()
                .from(s)
                .where(
                  and(
                    eq(s.workspaceId, ws),
                    filter.propertyId ? eq(s.propertyId, filter.propertyId) : undefined,
                    filter.status ? eq(s.status, filter.status) : undefined,
                  ),
                )
                .orderBy(desc(s.createdAt), asc(s.id))
                .limit(101)
                .offset(filter.offset ?? 0)
            ).map(fromRow);
          },
          async overlaps(propertyId, checkIn, checkOut, excludeId) {
            const [r] = await tx
              .select({ id: s.id })
              .from(s)
              .where(
                and(
                  eq(s.workspaceId, ws),
                  eq(s.propertyId, propertyId),
                  eq(s.status, 'confirmed'),
                  lt(s.checkIn, checkOut),
                  gt(s.checkOut, checkIn),
                  excludeId ? sql`${s.id} <> ${excludeId}` : undefined,
                ),
              )
              .limit(1);
            return Boolean(r);
          },
          async insert(r) {
            await tx.insert(s).values({
              id: r.id,
              workspaceId: ws,
              propertyId: r.propertyId,
              propertyName: r.propertyName,
              clientRequestId: r.clientRequestId,
              fingerprint: r.fingerprint,
              guestName: r.guestName,
              guestPhone: r.guestPhone,
              checkIn: r.dates.checkIn,
              checkOut: r.dates.checkOut,
              party: r.party,
              quote: r.quote,
              note: r.note,
              status: r.status,
              agreedTotal: r.agreedTotal,
              version: r.version,
              createdAt: new Date(r.createdAt),
              updatedAt: new Date(r.updatedAt),
            });
          },
          async update(r) {
            await tx
              .update(s)
              .set({
                status: r.status,
                agreedTotal: r.agreedTotal,
                version: r.version,
                updatedAt: new Date(r.updatedAt),
              })
              .where(rowScope(r.id));
          },
          async audit(actorId, id, status) {
            await writeAudit(tx, {
              workspaceId: ws,
              actorUserId: actorId,
              actorName: null,
              action: `commerce.stay.${status}`,
              targetType: 'stay_request',
              targetId: id,
              data: { status },
            });
          },
        };
        return fn(port);
      });
    } catch (e) {
      if (pgCode(e) === '23P01')
        throw new LodgingError(
          'CONFLICT',
          'The property already has a confirmed stay for these dates',
        );
      throw e;
    }
  }
}
