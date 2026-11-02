import type {
  AssistantMemoryDto,
  AssistantMessageList,
  AssistantProposalDto,
  AssistantProposalList,
  AssistantRunDto,
  AssistantSkillDto,
  AssistantSkillEventList,
  AssistantSkillList,
  AssistantThreadDto,
  AssistantThreadList,
  AssistantThreadListQuery,
  CreateAssistantSkillRequest,
  CreateAssistantThreadRequest,
  CreateImportBatchRequest,
  ImportBatchDto,
  SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  UpdateAssistantSkillRequest,
  UpdateAssistantThreadRequest,
} from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

/** The caller and the business the request came from; the facade checks they own its account. */
export interface AssistantActor {
  userId: UserId;
  businessId: WorkspaceId;
}

/**
 * PUBLIC CONTRACT of the assistant module (owner assistant, ADR-023). Every method first
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
  /**
   * `authorization` is the caller's own `Authorization` header: route tools read with it
   * (ruling 1b-R2). It is held in memory for the turn only, never stored or logged.
   * `displayName` (lazy) is read only when the turn compacts the thread and rebuilds its prompt.
   */
  sendMessage(
    actor: AssistantActor & { displayName?: () => Promise<string | null> },
    threadId: string,
    input: SendAssistantMessageRequest,
    authorization: string,
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
  /** The thread's proposals, oldest first; stale pending ones expire first. */
  listProposals(actor: AssistantActor, threadId: string): Promise<AssistantProposalList>;
  /**
   * Runs a pending proposal with the approver's own `authorization` (idempotency key
   * `asst:<id>`) and appends the outcome to the thread as an event. CONFLICT
   * `proposal_not_pending` / `proposal_expired`; NOT_FOUND when the proposal's business is no
   * longer in the owner's scope.
   */
  approveProposal(
    actor: AssistantActor,
    proposalId: string,
    authorization: string,
  ): Promise<AssistantProposalDto>;
  /** Pending → rejected, with an event message; CONFLICT as for approve. */
  rejectProposal(actor: AssistantActor, proposalId: string): Promise<AssistantProposalDto>;

  // ─── Product import (T-173) ───

  /**
   * A sheet the browser read, or photos already uploaded through `POST /products/images` that a
   * vision model drafts now (under the owner's turn lock: CONFLICT `assistant_busy`). NOT_FOUND
   * for a thread or business outside the scope; VALIDATION_FAILED `import_empty` /
   * `import_bad_image`. Purges the owner's batches older than 30 days.
   */
  createImportBatch(
    actor: AssistantActor,
    threadId: string,
    input: CreateImportBatchRequest,
  ): Promise<ImportBatchDto>;
  /** The batch's drafts, problems and results; NOT_FOUND when not the owner's or out of scope. */
  getImportBatch(actor: AssistantActor, batchId: string): Promise<ImportBatchDto>;

  // ─── Skills (1c) ───
  // Every change is recorded in the skill's ledger (actor `owner`) and can be undone.

  /** Platform skills (`shadowed` when the owner's active shadow replaces one), then every row. */
  listSkills(actor: AssistantActor): Promise<AssistantSkillList>;
  /** `skillRef` = a skill id or `platform:<name>`; NOT_FOUND otherwise. */
  getSkill(actor: AssistantActor, skillRef: string): Promise<AssistantSkillDto>;
  /**
   * An owner skill, active at once. VALIDATION_FAILED when the linter refuses it; CONFLICT
   * `skill_name_taken` (a platform or live skill has the name) or `skill_limit` (50 live skills).
   */
  createSkill(
    actor: AssistantActor,
    input: CreateAssistantSkillRequest,
  ): Promise<AssistantSkillDto>;
  updateSkill(
    actor: AssistantActor,
    skillId: string,
    patch: UpdateAssistantSkillRequest,
  ): Promise<AssistantSkillDto>;
  /** Shadow skills only (CONFLICT `not_a_shadow`): the platform skill comes back. */
  deleteSkill(actor: AssistantActor, skillId: string): Promise<void>;
  /** `pending_approval` → `active`; CONFLICT `skill_not_pending`. */
  approveSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto>;
  /** `pending_approval` → `archived`; CONFLICT `skill_not_pending`. */
  rejectSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto>;
  archiveSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto>;
  /** `stale` / `archived` → `active`; CONFLICT `skill_not_restorable`, `skill_limit`, `shadow_exists`. */
  restoreSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto>;
  /** Copies a platform skill into a shadow that replaces it; CONFLICT `shadow_exists`. */
  shadowSkill(actor: AssistantActor, platformName: string): Promise<AssistantSkillDto>;
  listSkillEvents(actor: AssistantActor, skillId: string): Promise<AssistantSkillEventList>;
  /** CONFLICT `event_already_undone`, `event_not_undoable` or `stale_skill`. */
  undoSkillEvent(actor: AssistantActor, eventId: string): Promise<AssistantSkillDto>;
}

export const ASSISTANT_FACADE = Symbol('ASSISTANT_FACADE');
