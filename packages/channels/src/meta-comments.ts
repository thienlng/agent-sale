import { createHash } from 'node:crypto';
import type { NormalizedEvent } from './adapter.js';
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9]+(?:_[0-9]+)?$/.test(v) && v.length <= 200;
/** Feed events are deliberately separate from Messenger messages and never open its reply window. */
export function parseFeedComments(body: unknown): NormalizedEvent[] {
  const root = rec(body),
    result: NormalizedEvent[] = [];
  if (root.object !== 'page') return result;
  for (const entry of arr(root.entry)) {
    const e = rec(entry);
    if (!id(e.id)) continue;
    for (const change of arr(e.changes)) {
      const c = rec(change),
        v = rec(c.value),
        from = rec(v.from);
      if (c.field !== 'feed' || v.item !== 'comment' || !id(v.post_id) || !id(v.comment_id))
        continue;
      if (!v.post_id.startsWith(`${e.id}_`)) continue;
      const operation = v.verb;
      if (operation !== 'add' && operation !== 'edited' && operation !== 'remove') continue;
      if (operation !== 'remove' && !id(from.id)) continue;
      if (from.id === e.id && (!id(v.parent_id) || v.parent_id === v.post_id)) continue;
      const at = typeof e.time === 'number' ? e.time : v.created_time;
      if (typeof at !== 'number' || at <= 0 || !Number.isFinite(at) || at > 8640000000000) continue;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([e.id, at, v]))
        .digest('hex');
      result.push({
        kind: 'facebook',
        assetExternalId: e.id,
        externalEventId: `comment:${fingerprint}`,
        externalMessageId: v.comment_id,
        type: 'comment',
        senderExternalId: id(from.id) ? from.id : '',
        occurredAt: new Date(at * 1000),
        text: typeof v.message === 'string' ? v.message.slice(0, 4000) : '',
        comment: {
          postId: v.post_id,
          commentId: v.comment_id,
          parentId: id(v.parent_id) && v.parent_id !== v.post_id ? v.parent_id : null,
          operation,
        },
        raw: change,
      });
    }
  }
  return result;
}
