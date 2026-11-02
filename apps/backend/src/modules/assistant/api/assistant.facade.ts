import type {
  AssistantMemoryDto,
  AssistantMessageList,
  AssistantRunDto,
  AssistantThreadDto,
  AssistantThreadList,
  AssistantThreadListQuery,
  CreateAssistantThreadRequest,
  SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  UpdateAssistantThreadRequest,
} from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

/** The caller and the business the request came from; the facade checks they own its account. */
export interface AssistantActor {
  userId: UserId;
  businessId: WorkspaceId;
}

/**
 * PUBLIC CONTRACT of the assistant module (owner assistant, ADR-022). Every method first
 * resolves the owner scope: FORBIDDEN unless the actor is an active owner of the business's
 * account; another owner's thread or run is NOT_FOUND. No other module consumes it yet.
 */
export interface AssistantFacade {
  listThreads(actor: AssistantActor, query: AssistantThreadListQuery): Promise<AssistantThreadList>;
  /** `ownerName` (the display name) goes into the thread's frozen system prompt. */
  createThread(
    actor: AssistantActor & { ownerName: string | null },
    input: CreateAssistantThreadRequest,
  ): Promise<AssistantThreadDto>;
  updateThread(
    actor: AssistantActor,
    threadId: string,
    patch: UpdateAssistantThreadRequest,
  ): Promise<AssistantThreadDto>;
  /** Visible messages only (user, assistant, event); tool rows never leave the backend. */
  listMessages(actor: AssistantActor, threadId: string): Promise<AssistantMessageList>;
  sendMessage(
    actor: AssistantActor,
    threadId: string,
    input: SendAssistantMessageRequest,
  ): Promise<SendAssistantMessageResponse>;
  getRun(actor: AssistantActor, runId: string): Promise<AssistantRunDto>;
  /**
   * Every memory store of the owner (owner_profile, notes, one per business of the account they
   * are a member of), with its limit and use, even when empty. Labels are English keys
   * (`owner_profile`, `notes`) or the business name; the web translates them.
   */
  getMemory(actor: AssistantActor): Promise<AssistantMemoryDto>;
  /** Forgets one entry and returns the remaining memory; NOT_FOUND for an unknown store or entry. */
  deleteMemoryEntry(
    actor: AssistantActor,
    store: string,
    entryId: string,
  ): Promise<AssistantMemoryDto>;
}

export const ASSISTANT_FACADE = Symbol('ASSISTANT_FACADE');
