import {
  nextDate,
  startOfLocalDay as localMidnight,
  userId,
  type WorkspaceId,
} from '@agent-sales/shared';

import type { WorkspaceFacade } from '../../workspace/api/index.js';
import {
  ArchivedChoiceError,
  CrmOptionNotFoundError,
  NotAMemberError,
} from '../domain/crm.errors.js';
import type { ContactRecord, CrmTx } from './ports/crm-store.js';

/** Fields compared for the audit history (derived and bookkeeping columns left out). */
const AUDITED = [
  'name',
  'phone',
  'email',
  'birthday',
  'gender',
  'address',
  'province',
  'ward',
  'sourceId',
  'statusId',
  'salesUserId',
  'careUserId',
  'adRef',
  'profileNote',
] as const satisfies ReadonlyArray<keyof ContactRecord>;

/** field → {from, to} for every audited field that differs. */
export function diff(
  before: ContactRecord,
  after: ContactRecord,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of AUDITED) {
    const from = before[k] ?? null;
    const to = after[k] ?? null;
    if (from !== to && !(k === 'profileNote' && !from && !to)) out[k] = { from, to };
  }
  return out;
}

/** Sales and CSKH must be active members of the workspace (checked before the transaction). */
export async function assertAssignable(
  workspaces: WorkspaceFacade,
  ws: WorkspaceId,
  f: { salesUserId?: string | null | undefined; careUserId?: string | null | undefined },
): Promise<void> {
  const wanted = (
    [
      ['sales', f.salesUserId],
      ['care', f.careUserId],
    ] as const
  ).filter((x): x is readonly ['sales' | 'care', string] => Boolean(x[1]));
  if (!wanted.length) return;
  const members = new Set((await workspaces.listMembers(ws)).map((m) => String(m.userId)));
  for (const [role, id] of wanted) {
    if (!members.has(String(userId(id)))) throw new NotAMemberError(role, id);
  }
}

/**
 * A newly chosen source or status must exist and not be archived; keeping the
 * one the contact already has is always allowed.
 */
export async function assertChoosable(
  tx: CrmTx,
  f: { sourceId?: string | null | undefined; statusId?: string | null | undefined },
  before: Partial<Pick<ContactRecord, 'sourceId' | 'statusId'>>,
): Promise<void> {
  for (const [kind, field] of [
    ['source', 'sourceId'],
    ['status', 'statusId'],
  ] as const) {
    const id = f[field];
    if (!id || id === before[field]) continue;
    const option = await tx.options.find(kind, id);
    if (!option) throw new CrmOptionNotFoundError(kind, id);
    if (option.archivedAt) throw new ArchivedChoiceError(kind, id);
  }
}

/** UTC instant of local midnight of `date` (+ `addDays`) in the workspace time zone. */
export function startOfLocalDay(date: string, timeZone: string, addDays: 0 | 1): Date {
  return localMidnight(addDays ? nextDate(date) : date, timeZone);
}
