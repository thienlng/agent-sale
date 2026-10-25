import {
  ActionInput,
  type ActionDto,
  type ActionTestResult,
  type UpdateActionRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import type {
  ActionFacade,
  ActionOutcome,
  BotActionView,
  PendingAction,
} from '../api/action.facade.js';
import { ActionNotFoundError, InvalidActionError } from '../domain/action.errors.js';
import {
  ACTION_UOW,
  type ActionRecord,
  type ActionUnitOfWork,
} from './ports/action-unit-of-work.js';

function toDto({ authSecretEnc, ...rest }: ActionRecord): ActionDto {
  return { ...rest, hasSecret: authSecretEnc !== null };
}

const notImplemented = (what: string) => new Error(`ActionFacade.${what} is not implemented yet`);

/** CRUD over the stored actions; the executor and pending store arrive with the action runner. */
@Injectable()
export class ActionFacadeImpl implements ActionFacade {
  constructor(
    @Inject(ACTION_UOW) private readonly uow: ActionUnitOfWork,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
  ) {}

  list(ws: WorkspaceId, botId: string): Promise<ActionDto[]> {
    return this.uow.run(ws, async (repo) => (await repo.list(botId)).map(toDto));
  }

  async get(ws: WorkspaceId, botId: string, id: string): Promise<ActionDto> {
    return toDto(await this.load(ws, botId, id));
  }

  create(ws: WorkspaceId, botId: string, input: ActionInput): Promise<ActionDto> {
    const { authSecret, ...fields } = this.validate(input);
    const now = new Date().toISOString();
    const record: ActionRecord = {
      ...fields,
      id: newId(),
      botId,
      authSecretEnc: this.seal(fields.auth.kind, authSecret),
      createdAt: now,
      updatedAt: now,
    };
    return this.uow.run(ws, async (repo) => {
      await repo.save(record);
      return toDto(record);
    });
  }

  update(
    ws: WorkspaceId,
    botId: string,
    id: string,
    patch: UpdateActionRequest,
  ): Promise<ActionDto> {
    if (!isUuid(id)) return Promise.reject(new ActionNotFoundError(id));
    return this.uow.run(ws, async (repo) => {
      const current = await repo.find(botId, id);
      if (!current) throw new ActionNotFoundError(id);
      const { authSecret, ...merged } = this.validate({
        ...patch,
        // Fields the patch leaves out keep their stored value.
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        url: patch.url ?? current.url,
        method: patch.method ?? current.method,
        params: patch.params ?? current.params,
        responses: patch.responses ?? current.responses,
        auth: patch.auth ?? current.auth,
        requiresConfirm: patch.requiresConfirm ?? current.requiresConfirm,
        enabled: patch.enabled ?? current.enabled,
      });
      let authSecretEnc = current.authSecretEnc;
      if (merged.auth.kind === 'none' || authSecret === '') authSecretEnc = null;
      else if (authSecret !== undefined) authSecretEnc = this.secrets.seal(authSecret);
      const next: ActionRecord = {
        ...merged,
        id,
        botId,
        authSecretEnc,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await repo.save(next);
      return toDto(next);
    });
  }

  remove(ws: WorkspaceId, botId: string, id: string): Promise<void> {
    if (!isUuid(id)) return Promise.reject(new ActionNotFoundError(id));
    return this.uow.run(ws, async (repo) => {
      if (!(await repo.delete(botId, id))) throw new ActionNotFoundError(id);
    });
  }

  /** Until the executor is wired, a test call reports a network failure. */
  async test(
    ws: WorkspaceId,
    botId: string,
    id: string,
    _args: Record<string, string | number | boolean>,
  ): Promise<ActionTestResult> {
    await this.load(ws, botId, id);
    return { ok: false, statusCode: null, data: null, errorCode: 'network', latencyMs: 0 };
  }

  listForBot(ws: WorkspaceId, botId: string): Promise<BotActionView[]> {
    return this.uow.run(ws, async (repo) =>
      (await repo.list(botId))
        .filter((a) => a.enabled)
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          method: a.method,
          requiresConfirm: a.requiresConfirm,
          params: a.params,
          responseFields: a.responses.flatMap((r) => r.fields),
        })),
    );
  }

  invoke(): Promise<ActionOutcome> {
    return Promise.reject(notImplemented('invoke'));
  }
  getPending(): Promise<PendingAction | null> {
    return Promise.reject(notImplemented('getPending'));
  }
  setPending(): Promise<void> {
    return Promise.reject(notImplemented('setPending'));
  }
  clearPending(): Promise<void> {
    return Promise.reject(notImplemented('clearPending'));
  }

  private async load(ws: WorkspaceId, botId: string, id: string): Promise<ActionRecord> {
    if (!isUuid(id)) throw new ActionNotFoundError(id);
    const record = await this.uow.run(ws, (repo) => repo.find(botId, id));
    if (!record) throw new ActionNotFoundError(id);
    return record;
  }

  private validate(input: ActionInput): ActionInput {
    const parsed = ActionInput.safeParse(input);
    if (!parsed.success)
      throw new InvalidActionError('Invalid action', { issues: parsed.error.issues.length });
    return parsed.data;
  }

  private seal(kind: string, secret: string | undefined): string | null {
    return kind === 'none' || !secret ? null : this.secrets.seal(secret);
  }
}
