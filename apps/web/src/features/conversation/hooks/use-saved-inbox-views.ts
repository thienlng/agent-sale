import { useState } from 'react';
import { z } from 'zod';
import type { ListState } from '../lib/inbox-list';

export const MAX_SAVED_INBOX_VIEWS = 5;
const ids = z.array(z.string().min(1).max(100)).max(50).default([]);
/** Every field has a default so views saved by earlier versions still load. */
const SavedFilters = z.object({
  tab: z.enum(['all', 'unread', 'waiting']).default('all'),
  tagsAny: ids,
  tagsAll: ids,
  tagsExclude: ids,
  untagged: z.boolean().default(false),
  waiting: z.enum(['off', 'any', 'longest', 'readNotReplied']).default('off'),
  mode: z.enum(['all', 'human', 'bot']).default('all'),
  assignee: z.string().min(1).max(100).default('all'),
  provider: z.enum(['all', 'facebook', 'instagram']).default('all'),
  channelId: z.string().min(1).max(100).default('all'),
  hasPhone: z.enum(['all', 'yes', 'no']).default('all'),
  status: z.enum(['all', 'open', 'resolved', 'spam']).default('open'),
  starred: z.boolean().default(false),
  followUp: z.boolean().default(false),
});
const SavedView = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(40),
  filters: SavedFilters,
});
export type SavedInboxView = z.infer<typeof SavedView>;

export function savedInboxViewKey(workspaceId: string, userId: string): string {
  return `rapiz.inbox.views:${encodeURIComponent(workspaceId)}:${encodeURIComponent(userId)}`;
}

export function parseSavedInboxViews(raw: string | null): SavedInboxView[] {
  if (!raw || raw.length > 20000) return [];
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    // One bad entry must not discard the rest.
    const valid = entries.flatMap((entry) => {
      const parsed = SavedView.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
    return valid
      .filter(
        (view, index, views) => views.findIndex((candidate) => candidate.id === view.id) === index,
      )
      .slice(0, MAX_SAVED_INBOX_VIEWS);
  } catch {
    return [];
  }
}

export function inboxViewFilters(state: ListState): SavedInboxView['filters'] {
  return SavedFilters.parse(state);
}

function readViews(key: string): { views: SavedInboxView[]; error: boolean } {
  try {
    return { views: parseSavedInboxViews(window.localStorage.getItem(key)), error: false };
  } catch {
    return { views: [], error: true };
  }
}

/** Each read and mutation belongs to the current workspace and user. */
export function useSavedInboxViews(workspaceId: string, userId: string) {
  const key = savedInboxViewKey(workspaceId, userId);
  const [stored, setStored] = useState(() => ({ key, ...readViews(key) }));
  const current = stored.key === key ? stored : { key, ...readViews(key) };
  function write(views: SavedInboxView[]): boolean {
    try {
      window.localStorage.setItem(key, JSON.stringify(views));
      setStored({ key, views, error: false });
      return true;
    } catch {
      setStored({ ...current, error: true });
      return false;
    }
  }
  function save(name: string, state: ListState): boolean {
    if (!workspaceId || !userId || current.views.length >= MAX_SAVED_INBOX_VIEWS) return false;
    let id: string;
    try {
      id = crypto.randomUUID();
    } catch {
      // Insecure contexts (plain HTTP) have no randomUUID.
      setStored({ ...current, error: true });
      return false;
    }
    const candidate = SavedView.safeParse({ id, name, filters: inboxViewFilters(state) });
    return candidate.success && write([...current.views, candidate.data]);
  }
  return {
    views: current.views,
    error: current.error,
    save,
    remove: (id: string) => write(current.views.filter((view) => view.id !== id)),
  };
}
