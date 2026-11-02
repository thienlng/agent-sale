import { create } from 'zustand';

export interface AssistantSpotlightTarget {
  /** A `data-assistant-target` id on the current page. */
  target: string;
  hint: string;
}

interface AssistantUiState {
  open: boolean;
  /** The business the thread and spotlight below belong to. */
  workspaceId: string | null;
  /** The thread shown in the panel; null starts a new one on the next send. */
  threadId: string | null;
  spotlight: AssistantSpotlightTarget | null;
  /** Text another page put in the composer (`openWith`); the composer takes it once. */
  draft: string | null;
  /** Entity ids added to the next message's page context (e.g. `messageAt`); taken at send. */
  entityExtras: Record<string, string> | null;
  setOpen: (open: boolean) => void;
  /** Opens the panel with `text` in the composer and `entity` for the next message. */
  openWith: (text: string, entity?: Record<string, string>) => void;
  takeDraft: () => string | null;
  takeEntityExtras: () => Record<string, string> | null;
  setThread: (threadId: string | null) => void;
  setSpotlight: (spotlight: AssistantSpotlightTarget | null) => void;
  /** Called with the current business: switching business starts over (no thread, no spotlight). */
  syncWorkspace: (workspaceId: string | null) => void;
}

/** UI state of the owner assistant: panel open, current thread and the spotlighted control. */
export const useAssistantUi = create<AssistantUiState>()((set, get) => ({
  open: false,
  workspaceId: null,
  threadId: null,
  spotlight: null,
  draft: null,
  entityExtras: null,
  setOpen: (open) => set({ open }),
  openWith: (text, entity = {}) =>
    set({
      open: true,
      spotlight: null,
      draft: text,
      entityExtras: Object.keys(entity).length ? entity : null,
    }),
  takeDraft: () => {
    const { draft } = get();
    if (draft !== null) set({ draft: null });
    return draft;
  },
  takeEntityExtras: () => {
    const { entityExtras } = get();
    if (entityExtras !== null) set({ entityExtras: null });
    return entityExtras;
  },
  setThread: (threadId) => set({ threadId }),
  setSpotlight: (spotlight) => set({ spotlight }),
  syncWorkspace: (workspaceId) => {
    if (get().workspaceId !== workspaceId) {
      set({ workspaceId, threadId: null, spotlight: null, draft: null, entityExtras: null });
    }
  },
}));

/** The current thread, only when it belongs to `workspaceId` (no stale id after a switch). */
export function useAssistantThreadId(workspaceId: string): string | null {
  return useAssistantUi((s) => (s.workspaceId === workspaceId ? s.threadId : null));
}
