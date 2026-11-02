import type {
  AcceptAssistantSuggestionResponse,
  AssistantLearningFeed,
  AssistantLearningQuery,
  AssistantMemoryDto,
  AssistantMessageFeedbackRequest,
  AssistantMessageList,
  AssistantProposalDto,
  AssistantProposalList,
  AssistantRunDto,
  AssistantSettingsDto,
  AssistantSkillDecisionRequest,
  AssistantSkillDto,
  AssistantSkillEventList,
  AssistantSkillList,
  AssistantSuggestionDto,
  AssistantSuggestionList,
  AssistantThreadDto,
  AssistantThreadList,
  AssistantThreadListQuery,
  CreateAssistantSkillRequest,
  CreateAssistantThreadRequest,
  SendAssistantMessageRequest,
  SendAssistantMessageResponse,
  UpdateAssistantSettingsRequest,
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
  /**
   * Undoes the review's change to one memory entry: an entry it rewrote gets its previous text
   * (and origin) back, an entry it added is forgotten. NOT_FOUND for an unknown store or entry.
   */
  undoLearnedMemory(
    actor: AssistantActor,
    store: string,
    entryId: string,
  ): Promise<AssistantMemoryDto>;
  /**
   * What the background review and the curator learned in the last `days` days (ruling 1c-R2):
   * skill ledger rows and memory entries with origin `review`, newest first, at most 20, each
   * with its undo handle.
   */
  getLearning(actor: AssistantActor, query: AssistantLearningQuery): Promise<AssistantLearningFeed>;
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
  /**
   * `pending_approval` → `active`, for the version the owner saw; CONFLICT `skill_not_pending`,
   * or `skill_changed` when the skill's `updatedAt` is no longer `expectedUpdatedAt`.
   */
  approveSkill(
    actor: AssistantActor,
    skillId: string,
    input: AssistantSkillDecisionRequest,
  ): Promise<AssistantSkillDto>;
  /** `pending_approval` → `archived`; CONFLICT as for approve. */
  rejectSkill(
    actor: AssistantActor,
    skillId: string,
    input: AssistantSkillDecisionRequest,
  ): Promise<AssistantSkillDto>;
  archiveSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto>;
  /** `stale` / `archived` → `active`; CONFLICT `skill_not_restorable`, `skill_limit`, `shadow_exists`. */
  restoreSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto>;
  /** Copies a platform skill into a shadow that replaces it; CONFLICT `shadow_exists`. */
  shadowSkill(actor: AssistantActor, platformName: string): Promise<AssistantSkillDto>;
  listSkillEvents(actor: AssistantActor, skillId: string): Promise<AssistantSkillEventList>;
  /** CONFLICT `event_already_undone`, `event_not_undoable` or `stale_skill`. */
  undoSkillEvent(actor: AssistantActor, eventId: string): Promise<AssistantSkillDto>;

  // ─── Settings, feedback and suggestions (1c) ───

  /** Review on/off, the disabled toolsets and every toolset with its last-30-day use. */
  getSettings(actor: AssistantActor): Promise<AssistantSettingsDto>;
  /** VALIDATION_FAILED when `core` or `ui` is in `disabledToolsets`. */
  updateSettings(
    actor: AssistantActor,
    patch: UpdateAssistantSettingsRequest,
  ): Promise<AssistantSettingsDto>;
  /** 👍/👎 (0 clears) on an assistant answer of the owner's own thread; NOT_FOUND otherwise. */
  setMessageFeedback(
    actor: AssistantActor,
    messageId: string,
    input: AssistantMessageFeedbackRequest,
  ): Promise<void>;
  /** Pending suggestion cards, newest first. */
  listSuggestions(actor: AssistantActor): Promise<AssistantSuggestionList>;
  /**
   * `skill` → an owner skill from the payload (as `createSkill`); `setup` → its in-app `path`;
   * `schedule` → accepted only. CONFLICT `suggestion_not_pending`.
   */
  acceptSuggestion(
    actor: AssistantActor,
    suggestionId: string,
  ): Promise<AcceptAssistantSuggestionResponse>;
  /** Permanent: the same `dedup_key` is never suggested again. CONFLICT `suggestion_not_pending`. */
  dismissSuggestion(actor: AssistantActor, suggestionId: string): Promise<AssistantSuggestionDto>;
}

export const ASSISTANT_FACADE = Symbol('ASSISTANT_FACADE');
