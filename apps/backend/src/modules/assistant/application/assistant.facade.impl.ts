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
import { isUuid, newId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../account/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { AssistantActor, AssistantFacade } from '../api/assistant.facade.js';
import { AssistantNotFoundError } from '../domain/assistant.errors.js';
import {
  businessOfStore,
  businessStore,
  compareStores,
  isKnownStore,
  memoryLimit,
  memoryUsed,
} from '../domain/memory-store.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type MemoryStoreRecord,
} from '../domain/ports/assistant.repository.js';
import { ChatTurnService } from './chat-turn.service.js';
import { learningFeed, undoReviewEntry } from './learning-feed.js';
import { toMessageDtos, toRunDto, toThreadDto } from './mappers.js';
import { accountMemberships, type OwnerScope, resolveOwnerScope } from './owner-access.js';
import { ProposalService } from './proposals.service.js';
import { AssistantSettingsService } from './settings.service.js';
import { SkillsService } from './skills.service.js';
import { SuggestionsService } from './suggestions.service.js';
import { ASSISTANT_PROMPT } from './prompt-builder.js';
import { ThreadPromptService } from './thread-prompt.service.js';

/** A malformed id names nothing the owner has. */
function knownId(what: 'thread' | 'run' | 'message', id: string): string {
  if (!isUuid(id)) throw new AssistantNotFoundError(what, id);
  return id;
}

/** Owner check first, then the repository; only proposals keep business data (1b-R10). */
@Injectable()
export class AssistantFacadeImpl implements AssistantFacade {
  constructor(
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ChatTurnService) private readonly chat: ChatTurnService,
    @Inject(ThreadPromptService) private readonly prompts: ThreadPromptService,
    @Inject(ProposalService) private readonly proposals: ProposalService,
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(AssistantSettingsService) private readonly settings: AssistantSettingsService,
    @Inject(SuggestionsService) private readonly suggestions: SuggestionsService,
  ) {}

  #scope(actor: AssistantActor): Promise<OwnerScope> {
    return resolveOwnerScope(
      { account: this.account, workspace: this.workspace },
      actor.userId,
      actor.businessId,
    );
  }

  async listThreads(
    actor: AssistantActor,
    query: AssistantThreadListQuery,
  ): Promise<AssistantThreadList> {
    const scope = await this.#scope(actor);
    const threads = await this.repo.listThreads(scope, {
      archived: query.archived === 'true',
      ...(query.q ? { text: query.q } : {}),
    });
    return { data: threads.map(toThreadDto) };
  }

  async createThread(
    actor: AssistantActor & { ownerName: string | null },
    input: CreateAssistantThreadRequest,
  ): Promise<AssistantThreadDto> {
    const scope = await this.#scope(actor);
    // The memory snapshot is read once here: the prompt stays frozen for the thread (1b-R6).
    const promptVersion = `${ASSISTANT_PROMPT.name}@${ASSISTANT_PROMPT.version}`;
    const systemPrompt = await this.prompts.build(scope, actor.ownerName, promptVersion);
    const thread = await this.repo.createThread(scope, {
      id: newId(),
      title: input.title ?? '',
      systemPrompt,
      promptVersion,
    });
    return toThreadDto(thread);
  }

  async updateThread(
    actor: AssistantActor,
    threadId: string,
    patch: UpdateAssistantThreadRequest,
  ): Promise<AssistantThreadDto> {
    const scope = await this.#scope(actor);
    const thread = await this.repo.updateThread(scope, knownId('thread', threadId), {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
    });
    if (!thread) throw new AssistantNotFoundError('thread', threadId);
    return toThreadDto(thread);
  }

  async listMessages(actor: AssistantActor, threadId: string): Promise<AssistantMessageList> {
    const scope = await this.#scope(actor);
    return {
      data: toMessageDtos(await this.repo.listMessages(scope, knownId('thread', threadId))),
    };
  }

  /** One chat turn (`ChatTurnService`); a retried `turnId` returns the first result. */
  async sendMessage(
    actor: AssistantActor & { displayName?: () => Promise<string | null> },
    threadId: string,
    input: SendAssistantMessageRequest,
    authorization: string,
  ): Promise<SendAssistantMessageResponse> {
    const scope = await this.#scope(actor);
    const turn = await this.chat.send(
      scope,
      knownId('thread', threadId),
      input,
      authorization,
      actor.displayName,
    );
    return { messages: toMessageDtos(turn.messages), run: toRunDto(turn.run) };
  }

  async getRun(actor: AssistantActor, runId: string): Promise<AssistantRunDto> {
    const scope = await this.#scope(actor);
    const run = await this.repo.getRun(scope, knownId('run', runId));
    if (!run) throw new AssistantNotFoundError('run', runId);
    return toRunDto(run);
  }

  async listProposals(actor: AssistantActor, threadId: string): Promise<AssistantProposalList> {
    const scope = await this.#scope(actor);
    return { items: await this.proposals.list(scope, threadId) };
  }

  async approveProposal(
    actor: AssistantActor,
    proposalId: string,
    authorization: string,
  ): Promise<AssistantProposalDto> {
    return this.proposals.approve(await this.#scope(actor), proposalId, authorization);
  }

  async rejectProposal(actor: AssistantActor, proposalId: string): Promise<AssistantProposalDto> {
    return this.proposals.reject(await this.#scope(actor), proposalId);
  }

  async listSkills(actor: AssistantActor): Promise<AssistantSkillList> {
    return this.skills.list(await this.#scope(actor));
  }

  async getSkill(actor: AssistantActor, skillRef: string): Promise<AssistantSkillDto> {
    return this.skills.read(await this.#scope(actor), skillRef);
  }

  async createSkill(
    actor: AssistantActor,
    input: CreateAssistantSkillRequest,
  ): Promise<AssistantSkillDto> {
    return this.skills.create(await this.#scope(actor), input);
  }

  async updateSkill(
    actor: AssistantActor,
    skillId: string,
    patch: UpdateAssistantSkillRequest,
  ): Promise<AssistantSkillDto> {
    return this.skills.update(await this.#scope(actor), skillId, patch);
  }

  async deleteSkill(actor: AssistantActor, skillId: string): Promise<void> {
    await this.skills.deleteShadow(await this.#scope(actor), skillId);
  }

  async approveSkill(
    actor: AssistantActor,
    skillId: string,
    input: AssistantSkillDecisionRequest,
  ): Promise<AssistantSkillDto> {
    const seen = new Date(input.expectedUpdatedAt);
    return this.skills.approve(await this.#scope(actor), skillId, seen);
  }

  async rejectSkill(
    actor: AssistantActor,
    skillId: string,
    input: AssistantSkillDecisionRequest,
  ): Promise<AssistantSkillDto> {
    const seen = new Date(input.expectedUpdatedAt);
    return this.skills.reject(await this.#scope(actor), skillId, seen);
  }

  async archiveSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto> {
    return this.skills.archive(await this.#scope(actor), skillId);
  }

  async restoreSkill(actor: AssistantActor, skillId: string): Promise<AssistantSkillDto> {
    return this.skills.restore(await this.#scope(actor), skillId);
  }

  async shadowSkill(actor: AssistantActor, platformName: string): Promise<AssistantSkillDto> {
    return this.skills.shadow(await this.#scope(actor), platformName);
  }

  async listSkillEvents(actor: AssistantActor, skillId: string): Promise<AssistantSkillEventList> {
    return this.skills.events(await this.#scope(actor), skillId);
  }

  async undoSkillEvent(actor: AssistantActor, eventId: string): Promise<AssistantSkillDto> {
    return this.skills.undo(await this.#scope(actor), eventId);
  }

  async getSettings(actor: AssistantActor): Promise<AssistantSettingsDto> {
    return this.settings.get(await this.#scope(actor));
  }

  async updateSettings(
    actor: AssistantActor,
    patch: UpdateAssistantSettingsRequest,
  ): Promise<AssistantSettingsDto> {
    return this.settings.update(await this.#scope(actor), patch);
  }

  async setMessageFeedback(
    actor: AssistantActor,
    messageId: string,
    input: AssistantMessageFeedbackRequest,
  ): Promise<void> {
    const scope = await this.#scope(actor);
    await this.repo.setFeedback(
      scope,
      knownId('message', messageId),
      input.value === 0 ? null : input.value,
    );
  }

  async listSuggestions(actor: AssistantActor): Promise<AssistantSuggestionList> {
    return this.suggestions.listPending(await this.#scope(actor));
  }

  async acceptSuggestion(
    actor: AssistantActor,
    suggestionId: string,
  ): Promise<AcceptAssistantSuggestionResponse> {
    return this.suggestions.accept(await this.#scope(actor), suggestionId);
  }

  async dismissSuggestion(
    actor: AssistantActor,
    suggestionId: string,
  ): Promise<AssistantSuggestionDto> {
    return this.suggestions.dismiss(await this.#scope(actor), suggestionId);
  }

  async getLearning(
    actor: AssistantActor,
    query: AssistantLearningQuery,
  ): Promise<AssistantLearningFeed> {
    const scope = await this.#scope(actor);
    return learningFeed(this.repo, scope, query.days);
  }

  async getMemory(actor: AssistantActor): Promise<AssistantMemoryDto> {
    const scope = await this.#scope(actor);
    return this.#memoryDto(scope, await this.repo.getMemory(scope));
  }

  async deleteMemoryEntry(
    actor: AssistantActor,
    store: string,
    entryId: string,
  ): Promise<AssistantMemoryDto> {
    const scope = await this.#scope(actor);
    if (!isKnownStore(store, scope.businessIds)) {
      throw new AssistantNotFoundError('memory entry', entryId);
    }
    const memory = await this.repo.getMemory(scope);
    const entries = memory.find((m) => m.store === store)?.entries ?? [];
    if (!entries.some((e) => e.id === entryId)) {
      throw new AssistantNotFoundError('memory entry', entryId);
    }
    const saved = await this.repo.saveMemoryStore(
      scope,
      store,
      entries.filter((e) => e.id !== entryId),
    );
    return this.#memoryDto(scope, [...memory.filter((m) => m.store !== store), saved]);
  }

  async undoLearnedMemory(
    actor: AssistantActor,
    store: string,
    entryId: string,
  ): Promise<AssistantMemoryDto> {
    const scope = await this.#scope(actor);
    if (!isKnownStore(store, scope.businessIds)) {
      throw new AssistantNotFoundError('memory entry', entryId);
    }
    const memory = await this.repo.getMemory(scope);
    const entries = memory.find((m) => m.store === store)?.entries ?? [];
    const next = undoReviewEntry(entries, entryId);
    if (!next) throw new AssistantNotFoundError('memory entry', entryId);
    const saved = await this.repo.saveMemoryStore(scope, store, next);
    return this.#memoryDto(scope, [...memory.filter((m) => m.store !== store), saved]);
  }

  /**
   * owner_profile, notes, then one store per business of the scope (business stores in id
   * order), empty ones included; stores of businesses outside the scope are not shown.
   */
  async #memoryDto(scope: OwnerScope, memory: MemoryStoreRecord[]): Promise<AssistantMemoryDto> {
    const names = new Map(
      (await accountMemberships(this.workspace, scope)).map((ms) => [
        ms.workspaceId as string,
        ms.workspaceName,
      ]),
    );
    const stores = ['owner_profile', 'notes', ...scope.businessIds.map(businessStore)].sort(
      compareStores,
    );
    return {
      stores: stores.map((store) => {
        const entries = memory.find((m) => m.store === store)?.entries ?? [];
        const business = businessOfStore(store);
        return {
          store,
          label: business === null ? store : (names.get(business) ?? store),
          limit: memoryLimit(store),
          used: memoryUsed(entries),
          entries: entries.map((e) => ({ id: e.id, text: e.text, createdAt: e.createdAt })),
        };
      }),
    };
  }
}
