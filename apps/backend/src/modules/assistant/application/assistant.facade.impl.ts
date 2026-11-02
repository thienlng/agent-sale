import type {
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
import {
  AssistantNotFoundError,
  AssistantNotImplementedError,
} from '../domain/assistant.errors.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
} from '../domain/ports/assistant.repository.js';
import { toMessageDtos, toRunDto, toThreadDto } from './mappers.js';
import { type OwnerScope, resolveOwnerScope } from './owner-access.js';
import { ASSISTANT_PROMPT, buildSystemPrompt, loadAssistantTemplate } from './prompt-builder.js';

/** A malformed id names nothing the owner has. */
function knownId(what: 'thread' | 'run', id: string): string {
  if (!isUuid(id)) throw new AssistantNotFoundError(what, id);
  return id;
}

/** Used in the prompt when the owner has no display name. */
const FALLBACK_OWNER_NAME = 'anh/chị';

/** Owner check first, then the repository; no business data is stored (ADR-021). */
@Injectable()
export class AssistantFacadeImpl implements AssistantFacade {
  constructor(
    @Inject(ACCOUNT_FACADE) private readonly account: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspace: WorkspaceFacade,
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
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
    const [template, memberships] = await Promise.all([
      loadAssistantTemplate(),
      this.workspace.listMemberships(actor.userId),
    ]);
    const businesses = memberships
      .filter((ms) => ms.accountId === scope.accountId)
      .map((ms) => ({ name: ms.workspaceName, industry: ms.industry }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.industry.localeCompare(b.industry));
    const systemPrompt = buildSystemPrompt(
      template,
      { ownerName: actor.ownerName?.trim() || FALLBACK_OWNER_NAME, businesses },
      new Date(),
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

  /** The chat turn arrives with the next slice (T-170 task 6); answers 500 until then. */
  async sendMessage(
    actor: AssistantActor,
    threadId: string,
    _input: SendAssistantMessageRequest,
  ): Promise<SendAssistantMessageResponse> {
    const scope = await this.#scope(actor);
    if (!(await this.repo.getThread(scope, knownId('thread', threadId))))
      throw new AssistantNotFoundError('thread', threadId);
    throw new AssistantNotImplementedError();
  }

  async getRun(actor: AssistantActor, runId: string): Promise<AssistantRunDto> {
    const scope = await this.#scope(actor);
    const run = await this.repo.getRun(scope, knownId('run', runId));
    if (!run) throw new AssistantNotFoundError('run', runId);
    return toRunDto(run);
  }
}
