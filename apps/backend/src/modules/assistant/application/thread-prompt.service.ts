import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { isKnownStore } from '../domain/memory-store.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
} from '../domain/ports/assistant.repository.js';
import { accountMemberships } from './owner-access.js';
import { buildSystemPrompt, loadThreadTemplate } from './prompt-builder.js';
import { SkillCatalog } from './skill-tools.js';

/** Used in the prompt when the owner has no display name. */
export const FALLBACK_OWNER_NAME = 'anh/chị';

/**
 * Builds a thread's frozen system prompt from what is true now: the account's businesses the
 * owner is a member of, the platform skills index and a fresh memory snapshot (stores of other
 * accounts' businesses are left out). Used when a thread starts and after each compaction
 * (spec §5: rebuilt only after compaction, memory re-read).
 */
@Injectable()
export class ThreadPromptService {
  constructor(
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(SkillCatalog) private readonly skills: SkillCatalog,
  ) {}

  async build(
    scope: OwnerScope,
    ownerName: string | null,
    promptVersion: string,
    today = new Date(),
  ): Promise<string> {
    const [template, memberships, memory] = await Promise.all([
      loadThreadTemplate(promptVersion),
      accountMemberships(this.workspace, scope),
      this.repo.getMemory(scope),
    ]);
    const businesses = memberships
      .map((ms) => ({ name: ms.workspaceName, industry: ms.industry }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.industry.localeCompare(b.industry));
    return buildSystemPrompt(
      template,
      { ownerName: ownerName?.trim() || FALLBACK_OWNER_NAME, businesses },
      today,
      {
        skillsIndex: this.skills.index(),
        memory: memory.filter((m) => isKnownStore(m.store, scope.businessIds)),
      },
    );
  }
}
