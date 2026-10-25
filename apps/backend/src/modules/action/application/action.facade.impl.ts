import {
  ActionInput,
  type ActionDto,
  type ActionTestResult,
  type UpdateActionRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import type {
  ActionFacade,
  ActionOutcome,
  BotActionView,
  PendingAction,
} from '../api/action.facade.js';
import { ActionNotFoundError, InvalidActionError } from '../domain/action.errors.js';
import { createSafeHttp } from '../domain/safe-http.js';
import { ActionRunner, type SafeHttp } from './action-runner.js';
import {
  ACTION_UOW,
  type ActionRecord,
  type ActionUnitOfWork,
  type PendingRecord,
} from './ports/action-unit-of-work.js';

function toDto({ authSecretEnc, ...rest }: ActionRecord): ActionDto {
  return { ...rest, hasSecret: authSecretEnc !== null };
}

export const SAFE_HTTP = Symbol('ACTION_SAFE_HTTP');

type Args = Record<string, string | number | boolean>;

/** A confirmation older than this is dropped: the customer's "yes" no longer refers to it. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

const withAskedAt = (p: PendingRecord): PendingAction => ({
  ...p,
  askedAt: new Date(p.expiresAt.getTime() - PENDING_TTL_MS),
});

/** CRUD over the stored actions, the safe executor (invoke/test) and the pending-confirmation store. */
@Injectable()
export class ActionFacadeImpl implements ActionFacade {
  constructor(
    @Inject(ACTION_UOW) private readonly uow: ActionUnitOfWork,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(SAFE_HTTP) @Optional() safeHttp?: SafeHttp,
  ) {
    this.runner = new ActionRunner(safeHttp ?? createSafeHttp(), secrets);
  }

  private readonly runner: ActionRunner;

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

  /** Executor call with sample args, recorded as an `is_test` run. Works on disabled actions too. */
  async test(ws: WorkspaceId, botId: string, id: string, args: Args): Promise<ActionTestResult> {
    const action = await this.load(ws, botId, id);
    const { outcome, latencyMs } = await this.execute(ws, action, {
      args,
      conversationId: null,
      idempotencyKey: `test:${newId()}`,
      isTest: true,
    });
    return outcome.ok
      ? { ok: true, statusCode: outcome.statusCode, data: outcome.data, errorCode: null, latencyMs }
      : {
          ok: false,
          statusCode: outcome.statusCode ?? null,
          data: null,
          errorCode: outcome.errorCode,
          latencyMs,
        };
  }

  /** Runs the draft as typed; unlike `test` it records no run (the action may not exist yet). */
  async testDraft(
    ws: WorkspaceId,
    botId: string,
    draft: { action: ActionInput; actionId?: string; args: Args },
  ): Promise<ActionTestResult> {
    const { authSecret, ...fields } = this.validate(draft.action);
    let authSecretEnc = this.seal(fields.auth.kind, authSecret);
    if (authSecretEnc === null && fields.auth.kind !== 'none' && authSecret === undefined) {
      const stored =
        draft.actionId && isUuid(draft.actionId)
          ? await this.uow.run(ws, (repo) => repo.find(botId, draft.actionId as string))
          : null;
      authSecretEnc = stored?.authSecretEnc ?? null;
    }
    const now = new Date().toISOString();
    const record: ActionRecord = {
      ...fields,
      id: newId(),
      botId,
      authSecretEnc,
      createdAt: now,
      updatedAt: now,
    };
    const { outcome, latencyMs } = await this.runner.run(record, draft.args, `test:${newId()}`);
    return outcome.ok
      ? { ok: true, statusCode: outcome.statusCode, data: outcome.data, errorCode: null, latencyMs }
      : {
          ok: false,
          statusCode: outcome.statusCode ?? null,
          data: null,
          errorCode: outcome.errorCode,
          latencyMs,
        };
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

  async invoke(
    ws: WorkspaceId,
    botId: string,
    call: Parameters<ActionFacade['invoke']>[2],
  ): Promise<ActionOutcome> {
    const action = isUuid(call.actionId)
      ? await this.uow.run(ws, (repo) => repo.find(botId, call.actionId))
      : null;
    if (!action) return { ok: false, errorCode: 'not_found' };
    if (!action.enabled) return { ok: false, errorCode: 'disabled' };
    return (await this.execute(ws, action, call)).outcome;
  }

  async getPending(ws: WorkspaceId, conversationId: string): Promise<PendingAction | null> {
    if (!isUuid(conversationId)) return null;
    const pending = await this.uow.run(ws, (repo) => repo.findPending(conversationId, new Date()));
    return pending && withAskedAt(pending);
  }

  async consumePending(ws: WorkspaceId, conversationId: string): Promise<PendingAction | null> {
    if (!isUuid(conversationId)) return null;
    const pending = await this.uow.run(ws, (repo) =>
      repo.consumePending(conversationId, new Date()),
    );
    return pending && withAskedAt(pending);
  }

  async setPending(
    ws: WorkspaceId,
    conversationId: string,
    pending: { actionId: string; args: Args },
  ): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(pending.actionId)) {
      throw new ActionNotFoundError(pending.actionId);
    }
    await this.uow.run(ws, async (repo) => {
      if (!(await repo.exists(pending.actionId))) throw new ActionNotFoundError(pending.actionId);
      await repo.savePending(conversationId, {
        actionId: pending.actionId,
        args: pending.args,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      });
    });
  }

  async clearPending(ws: WorkspaceId, conversationId: string): Promise<void> {
    if (!isUuid(conversationId)) return;
    await this.uow.run(ws, (repo) => repo.clearPending(conversationId));
  }

  /** Runs outside any DB transaction (the HTTP call can take seconds), then records the run. */
  private async execute(
    ws: WorkspaceId,
    action: ActionRecord,
    call: { args: Args; conversationId: string | null; idempotencyKey: string; isTest: boolean },
  ) {
    const result = await this.runner.run(action, call.args, call.idempotencyKey);
    const { outcome, latencyMs } = result;
    try {
      await this.uow.run(ws, (repo) =>
        repo.recordRun({
          id: newId(),
          actionId: action.id,
          conversationId: call.conversationId,
          statusCode: outcome.ok ? outcome.statusCode : (outcome.statusCode ?? null),
          ok: outcome.ok,
          latencyMs,
          errorCode: outcome.ok ? null : outcome.errorCode,
          isTest: call.isTest,
          createdAt: new Date(),
        }),
      );
    } catch {
      // Bookkeeping must not hide the outcome of a call that already happened.
    }
    return result;
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
