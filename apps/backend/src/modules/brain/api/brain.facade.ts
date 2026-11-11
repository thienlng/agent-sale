import type {
  BrainSettingsDto,
  BrainUsageDto,
  ConversationSignalDto,
  EvaluateSignalsStatus,
  SignalTrigger,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/**
 * PUBLIC CONTRACT of the brain module (spec 2026-11-11 §3): the AI's signals per conversation,
 * evaluated when a conversation goes idle or on request, within a daily cap.
 */
export interface BrainFacade {
  /** Signals of these conversations (those never evaluated are absent). At most 500 ids. */
  signalsFor(ws: WorkspaceId, conversationIds: readonly string[]): Promise<ConversationSignalDto[]>;
  /**
   * Evaluates one conversation now (counts toward the cap). Throws NOT_FOUND for an unknown
   * conversation and AI_UNAVAILABLE when the model failed (the signals are then unchanged).
   */
  evaluateNow(
    ws: WorkspaceId,
    conversationId: string,
    trigger: Exclude<SignalTrigger, 'idle'>,
  ): Promise<{ status: EvaluateSignalsStatus; signal: ConversationSignalDto | null }>;
  /** Evaluations used today (Asia/Ho_Chi_Minh) and the limit (`null` = unlimited). */
  usage(ws: WorkspaceId): Promise<BrainUsageDto>;
  settings(ws: WorkspaceId): Promise<BrainSettingsDto>;
}

export const BRAIN_FACADE = Symbol('BRAIN_FACADE');
