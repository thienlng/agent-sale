export interface FollowUpDraft {
  at: string;
  note: string;
  revision: number;
}
const drafts = new Map<string, FollowUpDraft>();
const listeners = new Map<string, Set<() => void>>();

export function readFollowUpDraft(key: string): FollowUpDraft | null {
  return drafts.get(key) ?? null;
}
export function writeFollowUpDraft(key: string, draft: FollowUpDraft | null): void {
  if (draft) drafts.set(key, draft);
  else drafts.delete(key);
  listeners.get(key)?.forEach((listener) => listener());
}
export function subscribeFollowUpDraft(key: string, listener: () => void): () => void {
  const group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener);
  listeners.set(key, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(key);
  };
}

/** datetime-local uses the operator's device timezone, not UTC. */
export function toLocalFollowUpInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function followUpInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  // Reject nonexistent local times (for example a clock jumping forward for DST).
  if (!Number.isFinite(date.getTime()) || toLocalFollowUpInput(date.toISOString()) !== value)
    return null;
  return date.toISOString();
}
