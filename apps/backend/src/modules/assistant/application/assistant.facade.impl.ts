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
import { toMessageDtos, toRunDto, toThreadDto } from './mappers.js';
import { type OwnerScope, resolveOwnerScope } from './owner-access.js';
import { ASSISTANT_PROMPT, buildSystemPrompt, loadAssistantTemplate } from './prompt-builder.js';
import { SkillCatalog } from './skill-tools.js';

/** A malformed id names nothing the owner has. */
function knownId(what: 'thread' | 'run', id: string): string {
  if (!isUuid(id)) throw new AssistantNotFoundError(what, id);
  return id;
}

/** Used in the prompt when the owner has no display name. */
const FALLBACK_OWNER_NAME = 'anh/chị';

/** Owner check first, then the repository; no business data is stored (ADR-022). */
@Injectable()
export class AssistantFacadeImpl implements AssistantFacade {
  constructor(
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ChatTurnService) private readonly chat: ChatTurnService,
    @Inject(SkillCatalog) private readonly skills: SkillCatalog,
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
    const [template, memberships, memory] = await Promise.all([
      loadAssistantTemplate(),
      this.workspace.listMemberships(actor.userId),
      this.repo.getMemory(scope),
    ]);
    const businesses = memberships
      .filter((ms) => ms.accountId === scope.accountId)
      .map((ms) => ({ name: ms.workspaceName, industry: ms.industry }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.industry.localeCompare(b.industry));
    const systemPrompt = buildSystemPrompt(
      template,
      { ownerName: actor.ownerName?.trim() || FALLBACK_OWNER_NAME, businesses },
      new Date(),
      {
        skillsIndex: this.skills.index(),
        memory: memory.filter((m) => isKnownStore(m.store, scope.businessIds)),
      },
    );
    const thread = await this.repo.createThread(scope, {
      id: newId(),
      title: input.title ?? '',
      systemPrompt,
      promptVersion: `${ASSISTANT_PROMPT.name}@${ASSISTANT_PROMPT.version}`,
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
    actor: AssistantActor,
    threadId: string,
    input: SendAssistantMessageRequest,
  ): Promise<SendAssistantMessageResponse> {
    const scope = await this.#scope(actor);
    const turn = await this.chat.send(scope, knownId('thread', threadId), input);
    return { messages: toMessageDtos(turn.messages), run: toRunDto(turn.run) };
  }

  async getRun(actor: AssistantActor, runId: string): Promise<AssistantRunDto> {
    const scope = await this.#scope(actor);
    const run = await this.repo.getRun(scope, knownId('run', runId));
    if (!run) throw new AssistantNotFoundError('run', runId);
    return toRunDto(run);
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

  /**
   * owner_profile, notes, then one store per business of the scope (business stores in id
   * order), empty ones included; stores of businesses outside the scope are not shown.
   */
  async #memoryDto(scope: OwnerScope, memory: MemoryStoreRecord[]): Promise<AssistantMemoryDto> {
    const names = new Map(
      (await this.workspace.listMemberships(scope.ownerUserId))
        .filter((ms) => ms.accountId === scope.accountId)
        .map((ms) => [ms.workspaceId as string, ms.workspaceName]),
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
