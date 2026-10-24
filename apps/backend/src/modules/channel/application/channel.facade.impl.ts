import { createHash, randomBytes } from 'node:crypto';
import { MetaAdapter, MetaRequestError } from '@agent-sales/channels';
import {
  ChannelConnectionDto,
  type MetaProvider,
  type UpdateChannelRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { getEnv } from '../../../common/config.js';
import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import type { ChannelFacade } from '../api/channel.facade.js';
import { ChannelError } from '../domain/channel.errors.js';
import { CHANNEL_STORE, type ChannelStore, type ConnectionRecord } from './ports/channel-store.js';
import { META_GATEWAY, type MetaGateway } from './ports/meta-gateway.js';
const GrantedAccounts = z.array(
  z.object({
    externalId: z.string(),
    name: z.string(),
    token: z.string(),
    expiresAt: z.string().nullable(),
  }),
);
export const hash = (v: string): string => createHash('sha256').update(v).digest('hex');
const publicConnection = (c: ConnectionRecord): ChannelConnectionDto =>
  ChannelConnectionDto.parse(c);
@Injectable()
export class ChannelFacadeImpl implements ChannelFacade {
  constructor(
    @Inject(CHANNEL_STORE) private readonly store: ChannelStore,
    @Inject(META_GATEWAY) private readonly gateway: MetaGateway,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
  ) {}
  async list(ws: WorkspaceId) {
    return {
      data: (await this.store.list(ws)).map(publicConnection),
      providers: (['facebook', 'instagram'] as const).map((provider) => ({
        provider,
        configured: this.gateway.configured(provider),
      })),
    };
  }
  async connect(ws: WorkspaceId, userId: string, provider: MetaProvider, browser: string) {
    const state = randomBytes(32).toString('base64url');
    const url = this.gateway.authorize(provider, state);
    await this.store.createFlow({
      id: newId(),
      workspaceId: ws,
      userId,
      provider,
      stateHash: hash(state),
      browserHash: hash(browser),
      accountsSealed: null,
      expiresAt: new Date(Date.now() + 600000),
    });
    return { url, state };
  }
  async callback(
    provider: MetaProvider,
    state: string,
    browser: string,
    code: string | null,
  ): Promise<string> {
    const flow = await this.store.consumeState(provider, hash(state), hash(browser));
    if (!flow)
      throw new ChannelError('NOT_FOUND', 'OAuth state expired, invalid or already consumed');
    if (!code) throw new ChannelError('VALIDATION_FAILED', 'Meta authorization was cancelled');
    const accounts = await this.gateway.exchange(provider, code);
    if (!accounts.length)
      throw new ChannelError('VALIDATION_FAILED', 'No accounts with messaging access were granted');
    const id = newId();
    await this.store.createFlow({
      ...flow,
      id,
      stateHash: hash(randomBytes(32).toString('hex')),
      accountsSealed: this.box.seal(JSON.stringify(accounts)),
      expiresAt: new Date(Date.now() + 600000),
    });
    return id;
  }
  async discovery(ws: WorkspaceId, userId: string, id: string) {
    const flow = await this.store.discovery(ws, userId, id);
    if (!flow?.accountsSealed)
      throw new ChannelError('NOT_FOUND', 'Discovery not found or expired');
    return {
      id,
      provider: flow.provider,
      accounts: GrantedAccounts.parse(JSON.parse(this.box.open(flow.accountsSealed))).map((a) => ({
        externalId: a.externalId,
        name: a.name,
      })),
    };
  }
  async select(ws: WorkspaceId, userId: string, id: string, externalIds: string[]) {
    const flow = await this.store.discovery(ws, userId, id);
    if (!flow?.accountsSealed)
      throw new ChannelError('NOT_FOUND', 'Discovery not found or expired');
    const granted = GrantedAccounts.parse(JSON.parse(this.box.open(flow.accountsSealed)));
    const selected = granted.filter((a) => externalIds.includes(a.externalId));
    if (new Set(externalIds).size !== selected.length)
      throw new ChannelError(
        'VALIDATION_FAILED',
        'Select only accounts granted in this consent flow',
      );
    for (const account of selected) await this.gateway.subscribe(flow.provider, account);
    const records = selected.map((a) => ({
      id: newId(),
      workspaceId: ws,
      provider: flow.provider,
      externalId: a.externalId,
      name: a.name,
      status: 'connected' as const,
      botId: null,
      tokenSealed: this.box.seal(a.token),
      expiresAt: a.expiresAt,
      createdAt: new Date().toISOString(),
    }));
    return { data: (await this.store.select(ws, userId, id, records)).map(publicConnection) };
  }
  async update(ws: WorkspaceId, id: string, input: UpdateChannelRequest) {
    if (input.botId) await this.bots.getBot(ws, input.botId);
    const current = await this.getConnection(ws, id);
    void current;
    const c = await this.store.update(ws, id, {
      ...(input.botId !== undefined ? { botId: input.botId } : {}),
      ...(input.disconnect ? { status: 'disconnected' as const, botId: null } : {}),
    });
    if (!c) throw new ChannelError('NOT_FOUND', 'Connection not found');
    return publicConnection(c);
  }
  async getConnection(ws: WorkspaceId, id: string) {
    const c = await this.store.get(ws, id);
    if (!c) throw new ChannelError('NOT_FOUND', 'Connection not found');
    return publicConnection(c);
  }
  async deliver(ws: WorkspaceId, id: string, recipient: string, text: string, key: string) {
    const c = await this.store.get(ws, id);
    if (!c || c.status !== 'connected' || (c.expiresAt && Date.parse(c.expiresAt) <= Date.now()))
      return { externalId: null, status: 'failed' as const, failureCode: 'reauth_required' };
    try {
      const result = await new MetaAdapter(c.provider, getEnv().META_GRAPH_VERSION).send(
        { externalId: c.externalId, token: this.box.open(c.tokenSealed) },
        recipient,
        { text },
        { idempotencyKey: key },
      );
      return { externalId: result.externalMessageId, status: 'sent' as const, failureCode: null };
    } catch (error) {
      const code = error instanceof MetaRequestError ? error.code : 'delivery_unknown';
      if (code === 'auth_expired') await this.store.update(ws, id, { status: 'reauth_required' });
      return {
        externalId: null,
        status:
          error instanceof MetaRequestError && !error.uncertain
            ? ('failed' as const)
            : ('unknown' as const),
        failureCode: code,
      };
    }
  }
  claimEvents(limit: number) {
    return this.store.claimEvents(limit);
  }
  renewEvent(id: string, claimToken: string) {
    return this.store.renewEvent(id, claimToken);
  }
  completeEvent(id: string, claimToken?: string) {
    return this.store.completeEvent(id, claimToken);
  }
}
