import { createHash, randomBytes } from 'node:crypto';
import { MetaAdapter, MetaRequestError, type NormalizedEvent } from '@agent-sales/channels';
import {
  ChannelConnectionDto,
  type CreateWebsiteRequest,
  type MetaProvider,
  type UpdateChannelRequest,
  type UpdateWebsiteRequest,
  WebsiteSettings,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { z } from 'zod';
import { getEnv } from '../../../common/config.js';
import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  BOT_FACADE,
  BOT_LIFECYCLE,
  type BotFacade,
  type BotLifecycle,
} from '../../bot/api/index.js';
import type { ChannelFacade, OutboundInboxMessage, WebsiteSite } from '../api/channel.facade.js';
import { ChannelError } from '../domain/channel.errors.js';
import { hostAllowed, newSiteKey, signVisitor, verifyVisitor } from '../domain/website-key.js';
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
const log = new Logger('ChannelFacade');
/** Opened visitor-signing secrets are cached per process, bounded so a long-lived API cannot grow. */
const SECRET_CACHE_MAX = 1000;
@Injectable()
export class ChannelFacadeImpl implements ChannelFacade, OnModuleInit {
  /** HTTP client for Meta profile reads; tests replace it with a fake. */
  transport: typeof fetch = fetch;
  constructor(
    @Inject(CHANNEL_STORE) private readonly store: ChannelStore,
    @Inject(META_GATEWAY) private readonly gateway: MetaGateway,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(BOT_LIFECYCLE) @Optional() private readonly lifecycle?: BotLifecycle,
  ) {}
  onModuleInit(): void {
    this.lifecycle?.onDeleted(async (ws, botId) => {
      await this.unbindBot(ws, botId);
    });
  }
  private readonly secrets = new Map<string, Buffer>();
  private secretOf(connectionId: string, tokenSealed: string): Buffer {
    const cached = this.secrets.get(connectionId);
    if (cached) return cached;
    const secret = Buffer.from(this.box.open(tokenSealed), 'base64');
    if (this.secrets.size >= SECRET_CACHE_MAX) {
      const oldest = this.secrets.keys().next().value;
      if (oldest !== undefined) this.secrets.delete(oldest);
    }
    this.secrets.set(connectionId, secret);
    return secret;
  }
  async createWebsite(ws: WorkspaceId, input: CreateWebsiteRequest) {
    if (input.botId) await this.bots.getBot(ws, input.botId);
    const record = await this.store.create({
      id: newId(),
      workspaceId: ws,
      provider: 'website',
      externalId: newSiteKey(),
      name: input.name,
      status: 'connected',
      botId: input.botId ?? null,
      // Signs visitor tokens; it never leaves the module.
      tokenSealed: this.box.seal(randomBytes(32).toString('base64')),
      expiresAt: null,
      settings: WebsiteSettings.parse({ domains: input.domains }),
      createdAt: new Date().toISOString(),
    });
    return publicConnection(record);
  }
  async updateWebsite(ws: WorkspaceId, id: string, input: UpdateWebsiteRequest) {
    const current = await this.store.get(ws, id);
    if (current?.provider !== 'website')
      throw new ChannelError('NOT_FOUND', 'Connection not found');
    const { name, enabled, ...changes } = input;
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const settings = WebsiteSettings.parse({ ...current.settings, ...defined });
    // Only on/off moves a site between 'disabled' and 'connected'; any other status is left alone.
    const status =
      enabled === true && current.status === 'disabled'
        ? ('connected' as const)
        : enabled === false && current.status === 'connected'
          ? ('disabled' as const)
          : undefined;
    const updated = await this.store.update(ws, id, {
      settings,
      ...(name !== undefined ? { name } : {}),
      ...(status ? { status } : {}),
    });
    if (!updated) throw new ChannelError('NOT_FOUND', 'Connection not found');
    return publicConnection(updated);
  }
  async resolveWebsite(siteKey: string): Promise<WebsiteSite | null> {
    const c = await this.store.findWebsite(siteKey);
    // Unusable stored settings: unknown to the public API, so no origin can ever pass.
    if (!c?.settings) return null;
    // Warm the signing-secret cache so polling needs no further query (the secret stays here).
    this.secretOf(c.id, c.tokenSealed);
    return {
      workspaceId: c.workspaceId,
      connectionId: c.id,
      siteKey: c.externalId,
      name: c.name,
      status: c.status,
      botId: c.botId,
      settings: c.settings,
    };
  }
  isOriginAllowed(site: WebsiteSite, origin: string | undefined): boolean {
    return hostAllowed(origin, site.settings.domains);
  }
  private async secretFor(site: WebsiteSite): Promise<Buffer | null> {
    const cached = this.secrets.get(site.connectionId);
    if (cached) return cached;
    const c = await this.store.get(site.workspaceId, site.connectionId);
    return c?.provider === 'website' ? this.secretOf(c.id, c.tokenSealed) : null;
  }
  async signVisitorToken(site: WebsiteSite, visitorId: string) {
    const secret = await this.secretFor(site);
    if (!secret) throw new ChannelError('NOT_FOUND', 'Connection not found');
    return signVisitor(secret, visitorId);
  }
  async verifyVisitorToken(site: WebsiteSite, token: string) {
    const secret = await this.secretFor(site);
    return secret ? verifyVisitor(secret, token) : null;
  }
  async enqueueWebsiteEvent(site: WebsiteSite, event: NormalizedEvent) {
    const c = await this.store.get(site.workspaceId, site.connectionId);
    if (c?.provider !== 'website') return false;
    return this.store.enqueueEvent(c, event);
  }
  hasPendingCustomerEvent(connectionId: string, senderExternalId: string) {
    return this.store.hasPendingCustomerEvent(connectionId, senderExternalId);
  }
  unbindBot(ws: WorkspaceId, botId: string): Promise<number> {
    return this.store.unbindBot(ws, botId);
  }
  async list(ws: WorkspaceId, opts: { includeRemoved?: boolean } = {}) {
    return {
      data: (await this.store.list(ws, opts)).map(publicConnection),
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
      settings: null,
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
  /**
   * Soft-removes a Facebook/Instagram page (T-133). The Meta webhook unsubscribe is best effort:
   * an expired token or a network error must not keep a dead page in the list.
   */
  async remove(ws: WorkspaceId, id: string): Promise<void> {
    const current = await this.store.get(ws, id);
    if (!current || current.status === 'removed')
      throw new ChannelError('NOT_FOUND', 'Connection not found');
    if (current.provider === 'website')
      throw new ChannelError(
        'VALIDATION_FAILED',
        'Website chat is turned off or disconnected, not removed',
      );
    // Database first: if it fails the page stays connected and subscribed. The unsubscribe uses
    // the token read above, so a reconnect racing this call re-subscribes with its new token.
    const removed = await this.store.remove(ws, id, this.box.seal(''));
    if (!removed) throw new ChannelError('NOT_FOUND', 'Connection not found');
    // Ids only: no page name, token or customer data.
    log.log(`Channel ${id} removed from workspace ${ws}`);
    await this.unsubscribeQuietly(current);
  }
  private async unsubscribeQuietly(c: ConnectionRecord): Promise<void> {
    if (c.provider === 'website') return;
    try {
      const token = this.box.open(c.tokenSealed);
      if (token) await this.gateway.unsubscribe(c.provider, { externalId: c.externalId, token });
    } catch {
      // The gateway already logged Meta's error code and subcode; nothing else is safe to log.
      log.warn(`Webhook unsubscribe skipped for channel ${c.id}`);
    }
  }
  async getConnection(ws: WorkspaceId, id: string) {
    const c = await this.store.get(ws, id);
    if (!c) throw new ChannelError('NOT_FOUND', 'Connection not found');
    return publicConnection(c);
  }
  async deliver(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    message: OutboundInboxMessage,
    key: string,
  ) {
    const c = await this.store.get(ws, id);
    // A website visitor reads the reply by polling; there is no platform to call.
    if (c?.provider === 'website')
      return c.status === 'connected'
        ? { externalId: null, status: 'sent' as const, failureCode: null }
        : { externalId: null, status: 'failed' as const, failureCode: 'site_disabled' };
    // A deliberately removed page is not a reconnect prompt.
    if (c?.status === 'removed')
      return { externalId: null, status: 'failed' as const, failureCode: 'page_removed' };
    if (!c || c.status !== 'connected' || (c.expiresAt && Date.parse(c.expiresAt) <= Date.now()))
      return { externalId: null, status: 'failed' as const, failureCode: 'reauth_required' };
    try {
      const meta = new MetaAdapter(c.provider, getEnv().META_GRAPH_VERSION, this.transport);
      const result = await meta.send(
        { externalId: c.externalId, token: this.box.open(c.tokenSealed) },
        recipient,
        message.attachments?.length
          ? { attachments: [...message.attachments] }
          : { text: message.text, quickReplies: [...(message.quickReplies ?? [])] },
        { idempotencyKey: key },
      );
      return { externalId: result.externalMessageId, status: 'sent' as const, failureCode: null };
    } catch (error) {
      const code = error instanceof MetaRequestError ? error.code : 'delivery_unknown';
      if (error instanceof MetaRequestError)
        log.warn(
          `Send on channel ${id} failed: ${code} (meta ${JSON.stringify(error.meta)}, ${message.attachments?.length ? `${message.attachments.length} attachment(s)` : 'text'})`,
        );
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
  async presence(
    ws: WorkspaceId,
    id: string,
    recipient: string,
    action: 'mark_seen' | 'typing_on',
  ): Promise<void> {
    try {
      const c = await this.store.get(ws, id);
      if (!c || c.status !== 'connected' || c.provider === 'website') return;
      await new MetaAdapter(c.provider, getEnv().META_GRAPH_VERSION).sendAction(
        { externalId: c.externalId, token: this.box.open(c.tokenSealed) },
        recipient,
        action,
      );
    } catch {
      // cosmetic only
    }
  }
  async fetchCustomerProfile(ws: WorkspaceId, id: string, customerExternalId: string) {
    const c = await this.store.get(ws, id);
    if (
      !c ||
      c.provider === 'website' ||
      c.status !== 'connected' ||
      (c.expiresAt && Date.parse(c.expiresAt) <= Date.now())
    )
      return null;
    try {
      return await new MetaAdapter(
        c.provider,
        getEnv().META_GRAPH_VERSION,
        this.transport,
      ).fetchProfile({ token: this.box.open(c.tokenSealed) }, customerExternalId);
    } catch (error) {
      // Only the failure code: the customer id and the token are never logged.
      log.warn(
        `Customer profile lookup failed (${error instanceof MetaRequestError ? error.code : 'unexpected'})`,
      );
      return null;
    }
  }
  claimEvents(limit: number) {
    return this.store.claimEvents(limit);
  }
  renewEvent(id: string, claimToken: string) {
    return this.store.renewEvent(id, claimToken);
  }
  completeEvent(id: string, claimToken: string) {
    return this.store.completeEvent(id, claimToken);
  }
  deadLetterEvent(id: string, claimToken: string) {
    return this.store.deadLetterEvent(id, claimToken);
  }
  deadLetterExhaustedEvents() {
    return this.store.deadLetterExhaustedEvents();
  }
  releaseEvent(id: string, claimToken: string, retryInMs: number) {
    return this.store.releaseEvent(id, claimToken, retryInMs);
  }
  requeueEvent(id: string, claimToken: string) {
    return this.store.requeueEvent(id, claimToken);
  }
  hasNewerCustomerEvent(connectionId: string, senderExternalId: string, afterEventId: string) {
    return this.store.hasNewerCustomerEvent(connectionId, senderExternalId, afterEventId);
  }
}
