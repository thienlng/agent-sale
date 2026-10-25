import type { ActionDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** A stored action: the DTO minus the derived flag, plus the sealed secret (never leaves the module). */
export type ActionRecord = Omit<ActionDto, 'hasSecret'> & { authSecretEnc: string | null };

export interface ActionRepository {
  list(botId: string): Promise<ActionRecord[]>;
  find(botId: string, id: string): Promise<ActionRecord | null>;
  save(record: ActionRecord): Promise<void>;
  delete(botId: string, id: string): Promise<boolean>;
}

export interface ActionUnitOfWork {
  run<T>(ws: WorkspaceId, fn: (repository: ActionRepository) => Promise<T>): Promise<T>;
}
export const ACTION_UOW = Symbol('ACTION_UOW');
