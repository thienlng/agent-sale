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
  setOpen: (open: boolean) => void;
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
  setOpen: (open) => set({ open }),
  setThread: (threadId) => set({ threadId }),
  setSpotlight: (spotlight) => set({ spotlight }),
  syncWorkspace: (workspaceId) => {
    if (get().workspaceId !== workspaceId) set({ workspaceId, threadId: null, spotlight: null });
  },
}));

/** The current thread, only when it belongs to `workspaceId` (no stale id after a switch). */
export function useAssistantThreadId(workspaceId: string): string | null {
  return useAssistantUi((s) => (s.workspaceId === workspaceId ? s.threadId : null));
}
