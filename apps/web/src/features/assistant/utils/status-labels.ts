/**
 * Raw statuses the owner must never read as code (B-STATUS): tool results, proposals, skills,
 * schedule runs and orders. The model sometimes quotes them (`awaiting_owner_approval`) and a
 * chart's categories can be order statuses; the panel shows the Vietnamese label instead.
 */
const RAW_STATUSES = new Set([
  'accepted',
  'active',
  'archived',
  'awaiting_confirmation',
  'awaiting_handover',
  'awaiting_owner_approval',
  'awaiting_print',
  'blocked',
  'cancelled',
  'confirmed',
  'created',
  'deleted',
  'delivered',
  'delivering',
  'delivery_failed',
  'dismissed',
  'done',
  'executing',
  'expired',
  'failed',
  'new',
  'not_run',
  'ordered',
  'packing',
  'paused',
  'pending',
  'pending_approval',
  'printed',
  'queued',
  'ready',
  'rejected',
  'returned',
  'returning',
  'running',
  'skipped',
  'stale',
]);

/** The label of a raw status (`t` of the `assistant` namespace), or null for any other text. */
export function statusLabel(t: (key: string) => string, raw: string): string | null {
  const key = raw.trim();
  return RAW_STATUSES.has(key) ? t(`rawStatus.${key}`) : null;
}
