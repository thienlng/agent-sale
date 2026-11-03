import {
  type AcceptAssistantSuggestionResponse,
  type AssistantSkillDto,
  type AssistantSuggestionDto,
  type AssistantSuggestionList,
  CreateAssistantSkillRequest,
} from '@agent-sales/contracts';
import { isUuid } from '@agent-sales/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  AssistantNotFoundError,
  AssistantScheduleInvalidError,
  AssistantSkillInvalidError,
  AssistantSuggestionConflictError,
} from '../domain/assistant.errors.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type OwnerKey,
  type SuggestionRecord,
} from '../domain/ports/assistant.repository.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import { SchedulesService } from './schedules.service.js';
import { SkillsService } from './skills.service.js';

/** An in-app page: `/app`, then path, query or hash characters only (no `//`, `\`, scheme). */
const APP_PATH = /^\/app(?:[/?#][\w\-./?#=&%~+,:@]*)?$/;

/** A `setup` suggestion's page when it is a safe in-app path (≤ 200 chars), else null. */
export function setupPath(payload: Record<string, unknown>): string | null {
  const path = payload.path;
  if (typeof path !== 'string' || path.length > 200) return null;
  if (!APP_PATH.test(path) || path.includes('//') || path.includes('..')) return null;
  return path;
}

export function toSuggestionDto(x: SuggestionRecord): AssistantSuggestionDto {
  return {
    id: x.id,
    kind: x.kind,
    title: x.title,
    payload: x.payload,
    status: x.status,
    createdAt: x.createdAt.toISOString(),
    decidedAt: x.decidedAt?.toISOString() ?? null,
  };
}

/**
 * Suggestion cards the background review saved (ruling 1c-R3). Accepting a `skill` card drafts
 * its payload as a learned skill waiting for approval (linted, limited, ledger actor `review`),
 * so the owner approves the body on the normal approval card; a `setup`
 * card returns its in-app page for the web to open; a `schedule` card is parsed as a schedule draft
 * by `SchedulesService.acceptSuggestion` (T-172) and answers `scheduleDraft`, which the web opens
 * in the schedule editor (saving it there is the approval); an invalid draft dismisses the card
 * and answers 400 `invalid_schedule_draft`. A dismissal is permanent: the review's `suggest` never reuses the key.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(SchedulesService)
    @Optional()
    private readonly schedules: SchedulesService | null = null,
  ) {}

  async listPending(s: OwnerKey): Promise<AssistantSuggestionList> {
    const items = await this.repo.listSuggestions(s, { status: 'pending' });
    return { items: items.map(toSuggestionDto) };
  }

  async accept(s: OwnerScope, id: string): Promise<AcceptAssistantSuggestionResponse> {
    const suggestion = await this.#pending(s, id);
    if (suggestion.kind === 'schedule' && this.schedules) {
      const out = await this.schedules.acceptSuggestion(s, suggestion.id);
      if (!out.ok) {
        if (out.errorCode === 'invalid_schedule_draft') {
          throw new AssistantScheduleInvalidError(['invalid_schedule_draft']);
        }
        throw new AssistantSuggestionConflictError();
      }
      const decided = (await this.repo.listSuggestions(s)).find((x) => x.id === suggestion.id);
      if (!decided) throw new AssistantSuggestionConflictError();
      return {
        suggestion: toSuggestionDto(decided),
        skill: null,
        path: null,
        scheduleDraft: out.scheduleDraft,
      };
    }
    let skill: AssistantSkillDto | null = null;
    if (suggestion.kind === 'skill') {
      const parsed = CreateAssistantSkillRequest.safeParse(suggestion.payload);
      if (!parsed.success) {
        throw new AssistantSkillInvalidError(parsed.error.issues.map((i) => i.message));
      }
      // The skill first: a refused skill leaves the card pending, so the owner can dismiss it.
      skill = await this.skills.draftFromSuggestion(s, parsed.data);
    }
    const decided = await this.repo.decideSuggestion(s, suggestion.id, 'accepted', new Date());
    if (!decided) throw new AssistantSuggestionConflictError();
    return {
      suggestion: toSuggestionDto(decided),
      skill,
      path: decided.kind === 'setup' ? setupPath(decided.payload) : null,
    };
  }

  async dismiss(s: OwnerKey, id: string): Promise<AssistantSuggestionDto> {
    const suggestion = await this.#pending(s, id);
    const decided = await this.repo.decideSuggestion(s, suggestion.id, 'dismissed', new Date());
    if (!decided) throw new AssistantSuggestionConflictError();
    return toSuggestionDto(decided);
  }

  /** The owner's suggestion (404 otherwise), still pending (409 `suggestion_not_pending`). */
  async #pending(s: OwnerKey, id: string): Promise<SuggestionRecord> {
    const found = isUuid(id)
      ? (await this.repo.listSuggestions(s)).find((x) => x.id === id)
      : undefined;
    if (!found) throw new AssistantNotFoundError('suggestion', id);
    if (found.status !== 'pending') throw new AssistantSuggestionConflictError();
    return found;
  }
}
