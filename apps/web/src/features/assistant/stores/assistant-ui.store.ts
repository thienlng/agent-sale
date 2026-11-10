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
  /** Text another page put in the composer (`openWith`); the composer takes it once. */
  draft: string | null;
  /** Entity ids added to the next message's page context (e.g. `messageAt`); taken at send. */
  entityExtras: Record<string, string> | null;
  /**
   * A schedule draft waiting to open in the editor (an accepted `schedule` suggestion, S3-R12);
   * the schedules view takes it and clears it.
   */
  scheduleDraft: Partial<ScheduleDraft> | null;
  /**
   * The full-page assistant's mount point (`/app/assistant`), or null off that page. While it is
   * set the panel renders the conversation there instead of in the side sheet.
   */
  pageSlot: HTMLElement | null;
  /** Leaving the full page opens the side sheet (collapse, or an answer that navigates). */
  sheetAfterPage: boolean;
  /** The last dashboard page other than the full assistant: where collapsing goes back to. */
  lastPage: string | null;
  setLastPage: (href: string) => void;
  setOpen: (open: boolean) => void;
  /** Opens the panel with `text` in the composer and `entity` for the next message. */
  openWith: (text: string, entity?: Record<string, string>) => void;
  takeDraft: () => string | null;
  takeEntityExtras: () => Record<string, string> | null;
  setThread: (threadId: string | null) => void;
  setSpotlight: (spotlight: AssistantSpotlightTarget | null) => void;
  /** Opens the panel on the schedule editor, prefilled with `draft`. */
  openScheduleEditor: (draft: Partial<ScheduleDraft>) => void;
  takeScheduleDraft: () => Partial<ScheduleDraft> | null;
  /**
   * The full page mounted (`el`) or left (null). Mounting closes the sheet; leaving opens it only
   * when `toSheet` asked for it, so a sheet opened meanwhile (a report notification) stays shut.
   */
  setPageSlot: (el: HTMLElement | null) => void;
  /** The conversation continues in the side sheet once the full page is left. */
  toSheet: () => void;
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
  scheduleDraft: null,
  pageSlot: null,
  sheetAfterPage: false,
  lastPage: null,
  setLastPage: (lastPage) => set({ lastPage }),
  // Closing on purpose (a spotlight or a dialog takes over) also cancels a pending reopen.
  setOpen: (open) => set(open ? { open } : { open, sheetAfterPage: false }),
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
  openScheduleEditor: (draft) => set({ open: true, scheduleDraft: draft }),
  takeScheduleDraft: () => {
    const draft = get().scheduleDraft;
    if (draft) set({ scheduleDraft: null });
    return draft;
  },
  setPageSlot: (el) => {
    if (el) set({ pageSlot: el, open: false, sheetAfterPage: false });
    else set({ pageSlot: null, open: get().sheetAfterPage, sheetAfterPage: false });
  },
  toSheet: () => set({ sheetAfterPage: true }),
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
