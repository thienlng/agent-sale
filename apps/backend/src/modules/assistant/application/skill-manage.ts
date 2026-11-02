import { newId } from '@agent-sales/shared';

import { AssistantSkillNameTakenError } from '../domain/assistant.errors.js';
import type {
  OwnerKey,
  SkillActor,
  SkillRecord,
  SkillState,
} from '../domain/ports/assistant.repository.js';
import { lintRow, SKILL_LIMIT, type SkillRules } from './skill-rules.js';

/** Who writes through `skill_manage`: the chat turn, or the background review (Task 3). */
export type SkillWriteActor = Extract<SkillActor, 'assistant' | 'review'>;

export interface SkillManageInput {
  action: 'create' | 'patch' | 'archive';
  name: string;
  description?: string | undefined;
  body?: string | undefined;
  reason?: string | undefined;
}

/** Per run: who writes, the run id for the ledger and the skills loaded in this run. */
export interface SkillWriteContext {
  actor: SkillWriteActor;
  runId: string | null;
  /** Names loaded with `load_skill` (or created) in this run: the read-before-write rule. */
  loadedSkills: Set<string>;
}

export type SkillManageOutcome =
  | { ok: true; message: string; name: string; state: SkillState }
  | { ok: false; errorCode: string; hint?: string };

const fail = (errorCode: string, hint?: string): SkillManageOutcome =>
  hint ? { ok: false, errorCode, hint } : { ok: false, errorCode };

/**
 * - chat (`assistant`): `create` makes an active owner skill; `patch` changes an owner or
 *   learned skill loaded in this turn; `archive` is the owner's (from the skills page).
 * - review: `create` makes a learned skill waiting for the owner; `patch` applies at once to an
 *   unpinned learned skill loaded in this run (pending ones included); `archive` only for
 *   unpinned learned skills. Owner skills, pinned skills and shadows are `not_allowed`.
 * Platform skills and their shadows are never changed here (`platform_skill_immutable`).
 */
export async function manageSkill(
  rules: SkillRules,
  s: OwnerKey,
  ctx: SkillWriteContext,
  input: SkillManageInput,
): Promise<SkillManageOutcome> {
  const name = input.name.trim();
  try {
    switch (input.action) {
      case 'create':
        return await manageCreate(rules, s, ctx, name, input);
      case 'patch':
        return await managePatch(rules, s, ctx, name, input);
      case 'archive':
        return await manageArchive(rules, s, ctx, name);
    }
  } catch (error) {
    if (error instanceof AssistantSkillNameTakenError) return fail('name_taken');
    throw error;
  }
}

async function manageCreate(
  rules: SkillRules,
  s: OwnerKey,
  ctx: SkillWriteContext,
  name: string,
  input: SkillManageInput,
): Promise<SkillManageOutcome> {
  const description = input.description?.trim() ?? '';
  const body = input.body?.trim() ?? '';
  if (!description || !body) return fail('missing_fields', 'create needs description and body');
  const problems = lintRow({ name, description, body, toolsets: [] });
  if (problems.length > 0) return fail(`invalid_skill:${problems.join('; ')}`);
  if (await rules.nameTaken(s, name)) return fail('name_taken');
  if (await rules.atLimit(s)) return fail('skill_limit', `at most ${SKILL_LIMIT} skills`);
  const review = ctx.actor === 'review';
  const created = await rules.repo.createSkill(
    s,
    {
      id: newId(),
      name,
      description,
      body,
      toolsets: [],
      provenance: review ? 'learned' : 'owner',
      shadowOf: null,
      state: review ? 'pending_approval' : 'active',
    },
    { id: newId(), actor: ctx.actor, action: 'create', runId: ctx.runId },
  );
  // Created in this run: it may be patched again without loading it first.
  ctx.loadedSkills.add(name);
  return {
    ok: true,
    message: review
      ? `Saved "${name}"; it waits for the owner's approval.`
      : `Saved "${name}"; it is active now.`,
    name,
    state: created.state,
  };
}

/** The owner's row by name, or why the model may not touch it. */
async function target(
  rules: SkillRules,
  s: OwnerKey,
  name: string,
): Promise<SkillRecord | SkillManageOutcome> {
  const row = await rules.repo.getSkillByName(s, name);
  if (row?.provenance === 'shadow' || (!row && rules.platform.get(name))) {
    return fail('platform_skill_immutable', 'the owner customises platform skills on the page');
  }
  return row ?? fail('unknown_skill');
}

/**
 * Ruling 1c-R6 (as Hermes protects user-owned and pinned skills from its background review):
 * the review patches or archives only learned skills the owner has not pinned. Owner skills,
 * pinned skills and shadows are the owner's.
 */
const reviewMayChange = (row: SkillRecord): boolean => row.provenance === 'learned' && !row.pinned;

async function managePatch(
  rules: SkillRules,
  s: OwnerKey,
  ctx: SkillWriteContext,
  name: string,
  input: SkillManageInput,
): Promise<SkillManageOutcome> {
  const row = await target(rules, s, name);
  if ('ok' in row) return row;
  if (ctx.actor === 'review' && !reviewMayChange(row)) {
    return fail('not_allowed', 'the review changes only unpinned learned skills');
  }
  if (!ctx.loadedSkills.has(name)) return fail('load_first', 'load_skill it in this run first');
  const description = input.description?.trim();
  const body = input.body?.trim();
  if (!description && !body) return fail('missing_fields', 'patch needs description or body');
  const next = { ...row, ...(description ? { description } : {}), ...(body ? { body } : {}) };
  const problems = lintRow(next);
  if (problems.length > 0) return fail(`invalid_skill:${problems.join('; ')}`);
  const updated = await rules.repo.updateSkill(
    s,
    row.id,
    {
      ...(description ? { description } : {}),
      ...(body ? { body } : {}),
      countPatch: true,
    },
    {
      expectedUpdatedAt: row.updatedAt,
      event: { id: newId(), actor: ctx.actor, action: 'patch', runId: ctx.runId },
    },
  );
  if (!updated) return fail('stale_skill', 'the skill changed meanwhile; load it again');
  return { ok: true, message: `Updated "${name}".`, name, state: updated.state };
}

async function manageArchive(
  rules: SkillRules,
  s: OwnerKey,
  ctx: SkillWriteContext,
  name: string,
): Promise<SkillManageOutcome> {
  const row = await target(rules, s, name);
  if ('ok' in row) return row;
  if (ctx.actor !== 'review' || !reviewMayChange(row)) {
    return fail('not_allowed', 'only the review archives, and only unpinned learned skills');
  }
  const updated = await rules.repo.updateSkill(
    s,
    row.id,
    { state: 'archived' },
    {
      expectedUpdatedAt: row.updatedAt,
      event: { id: newId(), actor: ctx.actor, action: 'archive', runId: ctx.runId },
    },
  );
  if (!updated) return fail('stale_skill');
  return { ok: true, message: `Archived "${name}".`, name, state: updated.state };
}
