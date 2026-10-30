import { createHash } from 'node:crypto';
import {
  CreateSaasRequest,
  SaasLeadDetails,
  type SaasRequestDto,
  type SaasRequestKind,
  type SaasRequestListQuery,
  UpdateSaasRequest,
} from '@agent-sales/contracts';
import { newId, normalizeAnyPhone, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { BotSaasRequestResult } from '../api/saas.facade.js';
import { assertRequestTransition, mergeLeadDetails, sameLead } from '../domain/saas-request.js';
import { SaasError } from '../domain/saas.errors.js';
import {
  SAAS_STORE,
  type SaasActor,
  type SaasStore,
  type SaasTx,
  type StoredRequest,
} from './ports/saas-store.js';

const PAGE = 100;
const dto = ({ clientRequestId: _k, fingerprint: _f, ...row }: StoredRequest): SaasRequestDto =>
  row;
const fingerprintOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** A UUID-shaped (version 8) key derived from `seed`. */
function uuidOf(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Deterministic request key of a bot conversation and kind. */
export function botRequestKey(conversationId: string, kind: SaasRequestKind): string {
  return uuidOf(`bot:${conversationId}:${kind}`);
}
/** Key of the request that follows a converted or closed one in the same conversation and kind. */
const nextBotRequestKey = (key: string, previousId: string) => uuidOf(`${key}:after:${previousId}`);
const FINISHED: ReadonlySet<string> = new Set(['converted', 'closed']);
const BotRequest = SaasLeadDetails.refine(
  (v) => Boolean(v.phone?.trim() || v.email),
  'give a phone number or an email',
);

@Injectable()
export class SaasRequestService {
  constructor(
    @Inject(SAAS_STORE) private readonly store: SaasStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}

  /** The SaaS screens and tools exist only for SaaS businesses; others see 404. */
  async assertSaas(ws: WorkspaceId): Promise<void> {
    if ((await this.workspaces.getById(ws)).industry !== 'saas')
      throw new SaasError('NOT_FOUND', 'SaaS workspace not found');
  }

  async list(
    ws: WorkspaceId,
    q: SaasRequestListQuery,
  ): Promise<{ data: SaasRequestDto[]; nextOffset: number | null }> {
    await this.assertSaas(ws);
    const rows = await this.store.run(ws, (tx) => tx.listRequests(q));
    return {
      data: rows.slice(0, PAGE).map(dto),
      nextOffset: rows.length > PAGE ? q.offset + PAGE : null,
    };
  }

  async get(ws: WorkspaceId, id: string): Promise<SaasRequestDto> {
    await this.assertSaas(ws);
    return this.store.run(ws, async (tx) => dto(await this.#find(tx, id)));
  }

  async create(ws: WorkspaceId, raw: unknown, actor: SaasActor): Promise<SaasRequestDto> {
    await this.assertSaas(ws);
    const input = CreateSaasRequest.parse(raw);
    if (input.contactId) await this.crm.getContact(ws, input.contactId);
    const fingerprint = fingerprintOf(input);
    return this.store.run(ws, async (tx) => {
      await tx.lockKey(input.clientRequestId);
      const existing = await tx.findRequestByKey(input.clientRequestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new SaasError('CONFLICT', 'This request key was used for different details');
        return dto(existing);
      }
      const { clientRequestId, kind, contactId, note, ...lead } = input;
      const now = new Date().toISOString();
      const row: StoredRequest = {
        id: newId(),
        clientRequestId,
        fingerprint,
        kind,
        status: 'new',
        source: 'staff',
        ...lead,
        contactId,
        conversationId: null,
        note,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insertRequest(row);
      await tx.audit(
        actor,
        'saas.request.created',
        { type: 'saas_request', id: row.id },
        {
          kind,
          source: 'staff',
        },
      );
      return dto(row);
    });
  }

  async update(
    ws: WorkspaceId,
    id: string,
    raw: unknown,
    actor: SaasActor,
  ): Promise<SaasRequestDto> {
    await this.assertSaas(ws);
    const { version, status, contactId, note, ...lead } = UpdateSaasRequest.parse(raw);
    if (contactId) await this.crm.getContact(ws, contactId);
    return this.store.run(ws, async (tx) => {
      const row = await this.#find(tx, id, true);
      if (row.version !== version)
        throw new SaasError('CONFLICT', 'The request changed; reload before updating');
      const from = row.status;
      if (status) assertRequestTransition(from, status);
      const next: StoredRequest = { ...row };
      for (const [k, v] of Object.entries(lead))
        if (v !== undefined) Object.assign(next, { [k]: v });
      if (!next.phone?.trim() && !next.email)
        throw new SaasError('VALIDATION_FAILED', 'Keep a phone number or an email');
      if (status) next.status = status;
      if (contactId !== undefined) next.contactId = contactId;
      if (note !== undefined) next.note = note;
      next.version += 1;
      next.updatedAt = new Date().toISOString();
      await tx.updateRequest(next);
      await tx.audit(
        actor,
        'saas.request.updated',
        { type: 'saas_request', id },
        {
          ...(status && status !== from ? { status: { from, to: status } } : {}),
          ...(contactId !== undefined ? { contactId } : {}),
        },
      );
      return dto(next);
    });
  }

  async recordFromBot(
    ws: WorkspaceId,
    input: {
      conversationId: string;
      contactId: string | null;
      kind: SaasRequestKind;
      details: unknown;
      preview: boolean;
    },
  ): Promise<BotSaasRequestResult> {
    const parsed = BotRequest.safeParse(input.details);
    if (!parsed.success)
      return {
        outcome: 'invalid',
        request: null,
        problems: parsed.error.issues.map((i) =>
          i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
        ),
      };
    if (input.preview) return { outcome: 'preview', request: null };
    await this.assertSaas(ws);
    const lead = parsed.data;
    const phone = lead.phone ? normalizeAnyPhone(lead.phone) : null;
    const contactId =
      input.contactId ?? (phone ? await this.crm.findContactIdByPhone(ws, phone) : null);
    const bot: SaasActor = { userId: null, name: null };
    return this.store.run(ws, async (tx) => {
      // The first key's lock serialises every request of this conversation and kind; a finished
      // request (converted or closed) does not block a new one, which takes the next key in the chain.
      let key = botRequestKey(input.conversationId, input.kind);
      await tx.lockKey(key);
      let existing = await tx.findRequestByKey(key, true);
      while (existing && FINISHED.has(existing.status)) {
        key = nextBotRequestKey(key, existing.id);
        existing = await tx.findRequestByKey(key, true);
      }
      if (existing) {
        if (existing.status !== 'new') return { outcome: 'in_progress', request: dto(existing) };
        const merged = mergeLeadDetails(existing, lead);
        const linked = existing.contactId ?? contactId;
        if (sameLead(existing, merged) && linked === existing.contactId)
          return { outcome: 'unchanged', request: dto(existing) };
        const next: StoredRequest = {
          ...existing,
          ...merged,
          contactId: linked,
          fingerprint: fingerprintOf(merged),
          version: existing.version + 1,
          updatedAt: new Date().toISOString(),
        };
        await tx.updateRequest(next);
        await tx.audit(
          bot,
          'saas.request.updated',
          { type: 'saas_request', id: next.id },
          {
            source: 'bot',
          },
        );
        return { outcome: 'updated', request: dto(next) };
      }
      const now = new Date().toISOString();
      const row: StoredRequest = {
        id: newId(),
        clientRequestId: key,
        fingerprint: fingerprintOf(lead),
        kind: input.kind,
        status: 'new',
        source: 'bot',
        ...lead,
        contactId,
        conversationId: input.conversationId,
        note: '',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insertRequest(row);
      await tx.audit(
        bot,
        'saas.request.created',
        { type: 'saas_request', id: row.id },
        {
          kind: input.kind,
          source: 'bot',
        },
      );
      return { outcome: 'created', request: dto(row) };
    });
  }

  async #find(tx: SaasTx, id: string, lock = false): Promise<StoredRequest> {
    const row = await tx.findRequest(id, lock);
    if (!row) throw new SaasError('NOT_FOUND', 'Request not found');
    return row;
  }
}
