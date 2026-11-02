import { create } from 'zustand';

/**
 * Opening the owner assistant from another feature (T-174): features may not import
 * `features/assistant`, so the bubble registers how to open itself here while it is on screen
 * (owners of the account only) and pages call `openAssistantWith`.
 */

/** Opens the panel with `text` in the composer and `entity` added to the next message's page context. */
export type AssistantOpener = (text: string, entity: Record<string, string>) => void;

const useOpener = create<{ open: AssistantOpener | null }>()(() => ({ open: null }));

/** Called by the bubble while it is shown; returns the unregister function. */
export function registerAssistantOpener(open: AssistantOpener): () => void {
  useOpener.setState({ open });
  return () => {
    if (useOpener.getState().open === open) useOpener.setState({ open: null });
  };
}

/** Whether the owner assistant is available on this screen (the same rule as the bubble). */
export function useAssistantAvailable(): boolean {
  return useOpener((s) => s.open !== null);
}

/** Opens the assistant with a prefilled message; false when it is not available. */
export function openAssistantWith(text: string, entity: Record<string, string> = {}): boolean {
  const open = useOpener.getState().open;
  if (!open) return false;
  open(text, entity);
  return true;
}
