import type { ActionDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** A stored action: the DTO minus the derived flag, plus the sealed secret (never leaves the module). */
export type ActionRecord = Omit<ActionDto, 'hasSecret'> & { authSecretEnc: string | null };

/** One executed call. Deliberately no arguments and no response body (PII). */
export interface ActionRunRecord {
  id: string;
  actionId: string;
  conversationId: string | null;
  statusCode: number | null;
  ok: boolean;
  latencyMs: number;
  errorCode: string | null;
  isTest: boolean;
  createdAt: Date;
}

export interface PendingRecord {
  actionId: string;
  args: Record<string, string | number | boolean>;
  expiresAt: Date;
}

export interface ActionRepository {
  list(botId: string): Promise<ActionRecord[]>;
  find(botId: string, id: string): Promise<ActionRecord | null>;
  save(record: ActionRecord): Promise<void>;
  delete(botId: string, id: string): Promise<boolean>;
  /** True when the action exists in this workspace (any bot). */
  exists(id: string): Promise<boolean>;
  recordRun(run: ActionRunRecord): Promise<void>;
  /** Unexpired pending call of the conversation, else null. */
  findPending(conversationId: string, now: Date): Promise<PendingRecord | null>;
  /** One pending call per conversation: replaces any existing one. */
  savePending(conversationId: string, pending: PendingRecord): Promise<void>;
  clearPending(conversationId: string): Promise<void>;
}

export interface ActionUnitOfWork {
  run<T>(ws: WorkspaceId, fn: (repository: ActionRepository) => Promise<T>): Promise<T>;
}
export const ACTION_UOW = Symbol('ACTION_UOW');
