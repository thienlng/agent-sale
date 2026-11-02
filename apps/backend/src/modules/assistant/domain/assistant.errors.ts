import { DomainError } from '@agent-sales/shared';

/** A thread, run, memory entry or proposal the owner does not have (another owner's rows look absent, never forbidden). */
export class AssistantNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(
    what:
      | 'thread'
      | 'run'
      | 'memory entry'
      | 'proposal'
      | 'message'
      | 'skill'
      | 'skill event'
      | 'schedule'
      | 'schedule run',
    id: string,
  ) {
    super(`Assistant ${what} not found`, { id });
  }
}

/** The assistant is for account owners only (billing members and staff are refused). */
export class AssistantForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('Only the account owner can use the assistant');
  }
}

/** Another run of this owner is still answering (409 CONFLICT, `details.reason = assistant_busy`). */
export class AssistantBusyError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The assistant is still answering the previous message', { reason: 'assistant_busy' });
  }
}

/**
 * The client turn id is already the id of a run the owner does not have (another owner's, or
 * another account's, invisible under RLS): 409 CONFLICT, never a 500.
 */
export class AssistantRunIdTakenError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This turn id is already used', { reason: 'turn_id_taken' });
  }
}

/**
 * The proposal cannot be decided: 409 CONFLICT with `details.reason` `proposal_not_pending`
 * (already approved, rejected or running) or `proposal_expired` (older than its 24 h).
 */
export class AssistantProposalConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(reason: 'proposal_not_pending' | 'proposal_expired') {
    super(
      reason === 'proposal_expired' ? 'This proposal has expired' : 'This proposal is not pending',
      { reason },
    );
  }
}

/** Another non-archived skill of this owner already has the name (409 CONFLICT). */
export class AssistantSkillNameTakenError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('A skill with this name already exists', { reason: 'skill_name_taken' });
  }
}

/** Why a skill change is refused (409 CONFLICT, `details.reason`). */
export type SkillConflictReason =
  | 'shadow_exists'
  | 'skill_limit'
  | 'skill_not_pending'
  | 'skill_not_restorable'
  | 'skill_archived'
  | 'not_a_shadow'
  | 'stale_skill'
  | 'event_already_undone'
  | 'event_not_undoable';

/** A skill change that does not apply to the skill's current state (409 CONFLICT). */
export class AssistantSkillConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(reason: SkillConflictReason) {
    super('This skill change cannot be applied', { reason });
  }
}

/** The skill text fails the linter or the safety scan (400, `details.problems`). */
export class AssistantSkillInvalidError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(problems: string[]) {
    super('The skill is not valid', { problems });
  }
}

/**
 * A schedule draft or edit that breaks a rule (T-172): 400 VALIDATION_FAILED with every problem
 * code in `details.problems` and the first in `details.reason` (`unknown_business`,
 * `schedule_limit`, `interval_too_short`…).
 */
export class AssistantScheduleInvalidError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(problems: readonly string[]) {
    super('The schedule is not valid', { reason: problems[0], problems: [...problems] });
  }
}

/**
 * A schedule action that cannot happen now: 409 CONFLICT with `details.reason` `run_too_soon`
 * (a manual run within 5 minutes), `schedule_paused`, `stale_schedule` (edited meanwhile) or
 * `run_has_no_report`.
 */
export class AssistantScheduleConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(reason: 'run_too_soon' | 'schedule_paused' | 'stale_schedule' | 'run_has_no_report') {
    super('This schedule action cannot run now', { reason });
  }
}
