import type { FanpageSettings, FanpageComment } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
export interface FanpageStore {
  privateComments(
    ws: WorkspaceId,
    connectionId: string,
    recipientId: string,
  ): Promise<FanpageComment[]>;
  interrupted(ws: WorkspaceId, connectionId: string, comment: FanpageComment): Promise<boolean>;
  settings(ws: WorkspaceId, connectionId: string): Promise<FanpageSettings>;
  saveSettings(ws: WorkspaceId, connectionId: string, settings: FanpageSettings): Promise<void>;
  list(ws: WorkspaceId, connectionId: string): Promise<FanpageComment[]>;
  /** Serializes decisions and action reservations on one comment; no network work in this callback. */
  change<T>(
    ws: WorkspaceId,
    connectionId: string,
    commentId: string,
    fn: (current: FanpageComment | null) => { comment: FanpageComment | null; result: T },
  ): Promise<T>;
}
export const FANPAGE_STORE = Symbol('FANPAGE_STORE');
