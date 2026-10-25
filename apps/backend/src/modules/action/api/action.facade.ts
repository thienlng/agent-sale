import type {
  ActionDto,
  ActionErrorCode,
  ActionInput,
  ActionParam,
  ActionTestResult,
  UpdateActionRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** What the prompt shows the model about an enabled action. Never carries the URL or any secret. */
export interface BotActionView {
  id: string;
  name: string;
  description: string;
  method: string;
  requiresConfirm: boolean;
  params: ActionParam[];
  responseFields: { name: string; type: string; description: string }[];
}

export type ActionOutcome =
  | { ok: true; statusCode: number; data: unknown }
  | { ok: false; errorCode: ActionErrorCode; statusCode?: number };

export interface PendingAction {
  actionId: string;
  args: Record<string, string | number | boolean>;
  expiresAt: Date;
  /** When the customer was asked; the model uses the age to doubt a stale "ok". */
  askedAt: Date;
}

/**
 * PUBLIC CONTRACT of the action module. The caller verifies that `botId` belongs to the
 * workspace (the bot controller does); RLS still guarantees no cross-tenant access.
 */
export interface ActionFacade {
  list(ws: WorkspaceId, botId: string): Promise<ActionDto[]>;
  get(ws: WorkspaceId, botId: string, id: string): Promise<ActionDto>;
  create(ws: WorkspaceId, botId: string, input: ActionInput): Promise<ActionDto>;
  /** `authSecret` absent keeps the stored secret, `''` clears it. */
  update(
    ws: WorkspaceId,
    botId: string,
    id: string,
    patch: UpdateActionRequest,
  ): Promise<ActionDto>;
  remove(ws: WorkspaceId, botId: string, id: string): Promise<void>;
  /** Executor call with sample args, recorded as an `is_test` run. */
  test(
    ws: WorkspaceId,
    botId: string,
    id: string,
    args: Record<string, string | number | boolean>,
  ): Promise<ActionTestResult>;
  /**
   * Executes an unsaved draft once. Nothing is stored or recorded. A blank `authSecret` falls back
   * to the stored secret of `actionId` (editing), so the owner need not retype it to test.
   */
  testDraft(
    ws: WorkspaceId,
    botId: string,
    draft: {
      action: ActionInput;
      actionId?: string;
      args: Record<string, string | number | boolean>;
    },
  ): Promise<ActionTestResult>;
  /** Enabled actions only, shaped for the prompt. */
  listForBot(ws: WorkspaceId, botId: string): Promise<BotActionView[]>;
  invoke(
    ws: WorkspaceId,
    botId: string,
    call: {
      actionId: string;
      args: Record<string, string | number | boolean>;
      conversationId: string | null;
      idempotencyKey: string;
      isTest: boolean;
    },
  ): Promise<ActionOutcome>;
  getPending(ws: WorkspaceId, conversationId: string): Promise<PendingAction | null>;
  setPending(
    ws: WorkspaceId,
    conversationId: string,
    pending: { actionId: string; args: Record<string, string | number | boolean> },
  ): Promise<void>;
  clearPending(ws: WorkspaceId, conversationId: string): Promise<void>;
  /** Atomic take: returns the pending call and removes it, so only one caller can run it. */
  consumePending(ws: WorkspaceId, conversationId: string): Promise<PendingAction | null>;
}

export const ACTION_FACADE = Symbol('ACTION_FACADE');
