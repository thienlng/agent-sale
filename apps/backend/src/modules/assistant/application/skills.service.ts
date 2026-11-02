import type {
  AssistantSkillDto,
  AssistantSkillEventList,
  AssistantSkillList,
  CreateAssistantSkillRequest,
  UpdateAssistantSkillRequest,
} from '@agent-sales/contracts';
import { isUuid, newId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  AssistantNotFoundError,
  AssistantSkillConflictError,
  AssistantSkillInvalidError,
  AssistantSkillNameTakenError,
} from '../domain/assistant.errors.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type OwnerKey,
  type SkillAction,
  type SkillPatch,
  type SkillRecord,
  type SkillState,
  skillSnapshot,
} from '../domain/ports/assistant.repository.js';
import {
  PLATFORM_SKILL_REF,
  toPlatformSkillDto,
  toPlatformSkillSummary,
  toSkillDto,
  toSkillEventDto,
  toSkillSummary,
} from './mappers.js';
import {
  manageSkill,
  type SkillManageInput,
  type SkillManageOutcome,
  type SkillWriteContext,
} from './skill-manage.js';
import { isLive, lintRow, SkillRules } from './skill-rules.js';
import { type CatalogSkill, OwnerSkillCatalog, SkillCatalog } from './skill-catalog.js';

export { type CatalogSkill, OwnerSkillCatalog } from './skill-catalog.js';

export { SKILL_LIMIT } from './skill-rules.js';
export type {
  SkillManageInput,
  SkillManageOutcome,
  SkillWriteActor,
  SkillWriteContext,
} from './skill-manage.js';

/**
 * Owner, learned and shadow skills (spec §10, 1c Task 2). Platform skills are files
 * (`SkillCatalog`) and never change; every row change is linted, bounded (50 live owner and
 * learned skills, one live shadow per platform skill) and recorded in the ledger in the same
 * transaction, so any single change can be undone. Skill text never reaches the logs.
 */
@Injectable()
export class SkillsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(SkillCatalog) private readonly platform: SkillCatalog,
  ) {
    this.#rules = new SkillRules(repo, platform);
  }

  readonly #rules: SkillRules;

  // ─── Catalog ───

  async catalog(s: OwnerKey): Promise<OwnerSkillCatalog> {
    const rows = await this.repo.listSkills(s, { states: ['active'] });
    const shadows = new Map(
      rows.filter((r) => r.provenance === 'shadow' && r.shadowOf).map((r) => [r.shadowOf, r]),
    );
    const entries: CatalogSkill[] = this.platform.list().map((p) => {
      const shadow = shadows.get(p.name);
      return shadow
        ? fromRow({ ...shadow, name: p.name })
        : {
            name: p.name,
            description: p.description,
            toolsets: p.toolsets,
            body: p.body,
            provenance: 'platform',
            rowId: null,
          };
    });
    const taken = new Set(entries.map((e) => e.name));
    for (const r of rows) {
      if (r.provenance === 'shadow' || taken.has(r.name)) continue;
      entries.push(fromRow(r));
    }
    return new OwnerSkillCatalog(entries);
  }

  /**
   * `load_skill`: the skill by name through the owner's catalog; a row's `use_count` and
   * `last_used_at` are bumped. Null when the owner's assistant has no such skill.
   */
  async load(
    s: OwnerKey,
    name: string,
    opts: { includePending?: boolean } = {},
  ): Promise<CatalogSkill | null> {
    const skill = (await this.catalog(s)).get(name);
    if (!skill) return opts.includePending ? this.#pendingLearned(s, name) : null;
    if (skill.rowId) await this.repo.bumpSkillCounter(s, skill.rowId, 'use');
    return skill;
  }

  /**
   * The review only (ruling 1c-R7): a learned skill still waiting for the owner, so a later
   * review can refine the draft before it is approved. Not a use: no counter is bumped.
   */
  async #pendingLearned(s: OwnerKey, name: string): Promise<CatalogSkill | null> {
    const row = await this.repo.getSkillByName(s, name);
    return row?.provenance === 'learned' && row.state === 'pending_approval' ? fromRow(row) : null;
  }

  // ─── Model writes (`skill_manage`) ───

  /** `skill_manage` (see `manageSkill`). */
  manage(
    s: OwnerKey,
    ctx: SkillWriteContext,
    input: SkillManageInput,
  ): Promise<SkillManageOutcome> {
    return manageSkill(this.#rules, s, ctx, input);
  }

  // ─── Owner routes ───

  /** Platform skills (by name, `shadowed` when an active shadow replaces one), then every row. */
  async list(s: OwnerKey): Promise<AssistantSkillList> {
    const rows = await this.repo.listSkills(s);
    const shadowed = activeShadows(rows);
    return {
      items: [
        ...this.platform.list().map((p) => toPlatformSkillSummary(p, shadowed.has(p.name))),
        ...rows.map(toSkillSummary),
      ],
    };
  }

  /** `ref` is a row id or `platform:<name>`. */
  async read(s: OwnerKey, ref: string): Promise<AssistantSkillDto> {
    if (ref.startsWith(PLATFORM_SKILL_REF)) {
      const doc = this.platform.get(ref.slice(PLATFORM_SKILL_REF.length));
      if (!doc) throw new AssistantNotFoundError('skill', ref);
      const rows = await this.repo.listSkills(s, { states: ['active'], provenance: ['shadow'] });
      return toPlatformSkillDto(doc, activeShadows(rows).has(doc.name));
    }
    return toSkillDto(await this.#row(s, ref));
  }

  async create(s: OwnerKey, input: CreateAssistantSkillRequest): Promise<AssistantSkillDto> {
    const skill = { name: input.name, description: input.description, body: input.body };
    assertValid(lintRow({ ...skill, toolsets: [] }));
    if (await this.#rules.nameTaken(s, skill.name)) throw new AssistantSkillNameTakenError();
    if (await this.#rules.atLimit(s)) throw new AssistantSkillConflictError('skill_limit');
    const created = await this.repo.createSkill(
      s,
      { id: newId(), ...skill, toolsets: [], provenance: 'owner', shadowOf: null, state: 'active' },
      ownerEvent('create'),
    );
    return toSkillDto(created);
  }

  /**
   * An accepted `skill` suggestion (ruling 1c-R3, final review): the review wrote it, so it is
   * a learned skill waiting for the owner (ledger actor `review`), approved on its own card
   * like any review draft, never an active owner skill installed from a headline.
   */
  async draftFromSuggestion(
    s: OwnerKey,
    input: CreateAssistantSkillRequest,
  ): Promise<AssistantSkillDto> {
    const skill = { name: input.name, description: input.description, body: input.body };
    assertValid(lintRow({ ...skill, toolsets: [] }));
    if (await this.#rules.nameTaken(s, skill.name)) throw new AssistantSkillNameTakenError();
    if (await this.#rules.atLimit(s)) throw new AssistantSkillConflictError('skill_limit');
    const created = await this.repo.createSkill(
      s,
      {
        id: newId(),
        ...skill,
        toolsets: [],
        provenance: 'learned',
        shadowOf: null,
        state: 'pending_approval',
      },
      { id: newId(), actor: 'review', action: 'create', runId: null },
    );
    return toSkillDto(created);
  }

  /** Description, body or pin; a content change is a ledger `patch`, a pin alone is not. */
  async update(
    s: OwnerKey,
    id: string,
    patch: UpdateAssistantSkillRequest,
  ): Promise<AssistantSkillDto> {
    const row = await this.#row(s, id);
    const content = {
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
    };
    const changed =
      (content.description !== undefined && content.description !== row.description) ||
      (content.body !== undefined && content.body !== row.body);
    if (changed) assertValid(lintRow({ ...row, ...content }));
    const updated = await this.repo.updateSkill(
      s,
      id,
      {
        ...content,
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(changed ? { countPatch: true } : {}),
      },
      { expectedUpdatedAt: row.updatedAt, ...(changed ? { event: ownerEvent('patch') } : {}) },
    );
    if (!updated) throw new AssistantSkillConflictError('stale_skill');
    return toSkillDto(updated);
  }

  /**
   * The owner's decision on a pending learned skill, for the version they saw: a skill changed
   * since `expectedUpdatedAt` (e.g. a review patched the draft) answers `skill_changed`.
   */
  approve(s: OwnerKey, id: string, expectedUpdatedAt: Date): Promise<AssistantSkillDto> {
    return this.#transition(s, id, ['pending_approval'], 'active', 'approve', 'skill_not_pending', {
      expectedUpdatedAt,
    });
  }

  reject(s: OwnerKey, id: string, expectedUpdatedAt: Date): Promise<AssistantSkillDto> {
    return this.#transition(
      s,
      id,
      ['pending_approval'],
      'archived',
      'reject',
      'skill_not_pending',
      {
        expectedUpdatedAt,
      },
    );
  }

  archive(s: OwnerKey, id: string): Promise<AssistantSkillDto> {
    return this.#transition(
      s,
      id,
      ['pending_approval', 'active', 'stale'],
      'archived',
      'archive',
      'skill_archived',
    );
  }

  restore(s: OwnerKey, id: string): Promise<AssistantSkillDto> {
    return this.#transition(
      s,
      id,
      ['stale', 'archived'],
      'active',
      'restore',
      'skill_not_restorable',
    );
  }

  /** "Tinh chỉnh": an active copy of the platform skill that replaces it for this owner. */
  async shadow(s: OwnerKey, name: string): Promise<AssistantSkillDto> {
    const doc = this.platform.get(name);
    if (!doc) throw new AssistantNotFoundError('skill', `${PLATFORM_SKILL_REF}${name}`);
    if (await this.#rules.shadowExists(s, name))
      throw new AssistantSkillConflictError('shadow_exists');
    try {
      const created = await this.repo.createSkill(
        s,
        {
          id: newId(),
          name: doc.name,
          description: doc.description,
          body: doc.body,
          toolsets: doc.toolsets,
          provenance: 'shadow',
          shadowOf: doc.name,
          state: 'active',
        },
        ownerEvent('create'),
      );
      return toSkillDto(created);
    } catch (error) {
      // A concurrent shadow (or a row of that name) won the unique index.
      if (error instanceof AssistantSkillNameTakenError) {
        throw new AssistantSkillConflictError('shadow_exists');
      }
      throw error;
    }
  }

  /**
   * Deletes a shadow so the platform skill comes back. The row is archived rather than removed,
   * so its ledger stays and the deletion itself can be undone.
   */
  async deleteShadow(s: OwnerKey, id: string): Promise<void> {
    const row = await this.#row(s, id);
    if (row.provenance !== 'shadow') throw new AssistantSkillConflictError('not_a_shadow');
    if (row.state === 'archived') return;
    const updated = await this.repo.updateSkill(
      s,
      id,
      { state: 'archived' },
      { expectedUpdatedAt: row.updatedAt, event: ownerEvent('archive') },
    );
    if (!updated) throw new AssistantSkillConflictError('stale_skill');
  }

  async events(s: OwnerKey, id: string): Promise<AssistantSkillEventList> {
    await this.#row(s, id);
    return { items: (await this.repo.listSkillEvents(s, { skillId: id })).map(toSkillEventDto) };
  }

  /**
   * Undoes one ledger entry: the skill goes back to the entry's `before` snapshot (a created
   * skill is archived), an `undo` entry is appended and the entry is marked undone. Only while
   * the skill still matches the entry's `after` snapshot (else `stale_skill`); an entry undone
   * already, or an `undo` entry, cannot be undone.
   */
  async undo(s: OwnerKey, eventId: string): Promise<AssistantSkillDto> {
    const event = isUuid(eventId) ? await this.repo.getSkillEvent(s, eventId) : null;
    if (!event) throw new AssistantNotFoundError('skill event', eventId);
    if (event.undoneAt) throw new AssistantSkillConflictError('event_already_undone');
    if (event.action === 'undo' || !event.after) {
      throw new AssistantSkillConflictError('event_not_undoable');
    }
    const row = await this.#row(s, event.skillId);
    if (!sameSnapshot(skillSnapshot(row), event.after)) {
      throw new AssistantSkillConflictError('stale_skill');
    }
    const target =
      event.action === 'create' || !event.before
        ? { ...event.after, state: 'archived' as const }
        : event.before;
    // A snapshot from before a lint rule existed must not come back unchecked.
    assertValid(lintRow({ ...target, toolsets: row.toolsets }));
    if (!isLive(row.state) && isLive(target.state)) await this.#rules.guardRevive(s, row);
    const patch: SkillPatch = {
      name: target.name,
      description: target.description,
      body: target.body,
      state: target.state,
    };
    const updated = await this.repo.updateSkill(s, row.id, patch, {
      expectedUpdatedAt: row.updatedAt,
      event: ownerEvent('undo'),
    });
    if (!updated) throw new AssistantSkillConflictError('stale_skill');
    await this.repo.markSkillEventUndone(s, event.id, new Date());
    return toSkillDto(updated);
  }

  // ─── Helpers ───

  async #row(s: OwnerKey, id: string): Promise<SkillRecord> {
    const row = isUuid(id) ? await this.repo.getSkill(s, id) : null;
    if (!row) throw new AssistantNotFoundError('skill', id);
    return row;
  }

  async #transition(
    s: OwnerKey,
    id: string,
    from: SkillState[],
    to: SkillState,
    action: SkillAction,
    refused: 'skill_not_pending' | 'skill_archived' | 'skill_not_restorable',
    seen?: { expectedUpdatedAt: Date },
  ): Promise<AssistantSkillDto> {
    const row = await this.#row(s, id);
    if (seen && row.updatedAt.getTime() !== seen.expectedUpdatedAt.getTime()) {
      throw new AssistantSkillConflictError('skill_changed');
    }
    if (!from.includes(row.state)) throw new AssistantSkillConflictError(refused);
    if (!isLive(row.state) && isLive(to)) await this.#rules.guardRevive(s, row);
    const updated = await this.repo.updateSkill(
      s,
      id,
      { state: to },
      { expectedUpdatedAt: row.updatedAt, event: ownerEvent(action) },
    );
    if (!updated) throw new AssistantSkillConflictError(seen ? 'skill_changed' : 'stale_skill');
    return toSkillDto(updated);
  }
}

function fromRow(r: SkillRecord): CatalogSkill {
  return {
    name: r.name,
    description: r.description,
    toolsets: r.toolsets,
    body: r.body,
    provenance: r.provenance,
    rowId: r.id,
  };
}

function activeShadows(rows: SkillRecord[]): Set<string> {
  return new Set(
    rows.flatMap((r) =>
      r.provenance === 'shadow' && r.state === 'active' && r.shadowOf ? [r.shadowOf] : [],
    ),
  );
}

function assertValid(problems: string[]): void {
  if (problems.length > 0) throw new AssistantSkillInvalidError(problems);
}

const ownerEvent = (action: SkillAction) => ({
  id: newId(),
  actor: 'owner' as const,
  action,
  runId: null,
});

function sameSnapshot(a: ReturnType<typeof skillSnapshot>, b: ReturnType<typeof skillSnapshot>) {
  return (
    a.name === b.name && a.description === b.description && a.body === b.body && a.state === b.state
  );
}
