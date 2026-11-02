import type { ScheduleDraft } from '@agent-sales/contracts';
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
  /**
   * A schedule draft waiting to open in the editor (an accepted `schedule` suggestion, S3-R12);
   * the schedules view takes it and clears it.
   */
  scheduleDraft: Partial<ScheduleDraft> | null;
  setOpen: (open: boolean) => void;
  setThread: (threadId: string | null) => void;
  setSpotlight: (spotlight: AssistantSpotlightTarget | null) => void;
  /** Opens the panel on the schedule editor, prefilled with `draft`. */
  openScheduleEditor: (draft: Partial<ScheduleDraft>) => void;
  takeScheduleDraft: () => Partial<ScheduleDraft> | null;
  /** Called with the current business: switching business starts over (no thread, no spotlight). */
  syncWorkspace: (workspaceId: string | null) => void;
}

/** UI state of the owner assistant: panel open, current thread and the spotlighted control. */
export const useAssistantUi = create<AssistantUiState>()((set, get) => ({
  open: false,
  workspaceId: null,
  threadId: null,
  spotlight: null,
  scheduleDraft: null,
  setOpen: (open) => set({ open }),
  setThread: (threadId) => set({ threadId }),
  setSpotlight: (spotlight) => set({ spotlight }),
  openScheduleEditor: (draft) => set({ open: true, scheduleDraft: draft }),
  takeScheduleDraft: () => {
    const draft = get().scheduleDraft;
    if (draft) set({ scheduleDraft: null });
    return draft;
  },
  syncWorkspace: (workspaceId) => {
    if (get().workspaceId !== workspaceId) set({ workspaceId, threadId: null, spotlight: null });
  },
}));

/** The current thread, only when it belongs to `workspaceId` (no stale id after a switch). */
export function useAssistantThreadId(workspaceId: string): string | null {
  return useAssistantUi((s) => (s.workspaceId === workspaceId ? s.threadId : null));
}
