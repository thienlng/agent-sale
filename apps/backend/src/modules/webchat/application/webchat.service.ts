import { createHash, randomBytes } from 'node:crypto';

import type { NormalizedEvent } from '@agent-sales/channels';
import {
  WidgetPhoneRequest,
  WidgetSendRequest,
  type WidgetConfigDto,
  type WidgetPollResponse,
  type WidgetSendResponse,
  type WidgetUploadResponse,
} from '@agent-sales/contracts';
import {
  findEmail,
  findVnPhone,
  isUuid,
  maskEmail,
  maskPhone,
  newId,
  normalizeLeadPhone,
} from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BOT_FACADE, type BotFacade } from '../../bot/api/index.js';
import { CHANNEL_FACADE, type ChannelFacade, type WebsiteSite } from '../../channel/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import {
  CRM_FACADE,
  type CrmFacade,
  websiteEmailLeadName,
  websiteLeadName,
} from '../../crm/api/index.js';
import { sniffUpload, UPLOAD_EXTENSIONS } from '../domain/image-sniff.js';
import { WebchatStorageUnavailableError } from '../domain/webchat.errors.js';
import { WidgetError } from './widget-error.js';
import { RATE_LIMITER, type RateLimiter } from './rate-limiter.js';
import { WEBCHAT_UPLOAD_STORAGE, type WebchatUploadStorage } from './ports/upload-storage.js';
import {
  DEFAULT_WEBCHAT_OPTIONS,
  WEBCHAT_OPTIONS,
  type WebchatOptions,
} from './ports/webchat-options.js';
import { VISITOR_STORE, type VisitorStore } from './ports/visitor-store.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const LANGUAGE_TTL_MS = 60 * SECOND;
const LANGUAGE_CACHE_MAX = 500;
/** Site lookups are cached briefly (also misses), so unauthenticated traffic cannot drive one DB query per request. */
const SITE_TTL_MS = 5 * SECOND;
const SITE_CACHE_MAX = 1000;
const DAY = 24 * HOUR;
/** Uploads live here until a message references them; the worker purges what stays (#17). */
export const TEMPORARY_UPLOAD_ROOT = 'webchat-tmp/';
/** Unreferenced uploads older than this are deleted. */
export const TEMPORARY_UPLOAD_TTL_MS = DAY;
/** Earlier messages scanned for a phone or email when the visitor writes again. */
const LEAD_SCAN_MESSAGES = 20;

/** What the controller knows about the HTTP request; the service never sees Fastify types. */
export interface PublicCall {
  key: string;
  origin: string | undefined;
  ip: string;
  authorization: string | undefined;
}

/** Page context of a first upload, from query parameters (the multipart body carries only the file). */
export interface UploadContext {
  firstUrl?: string | undefined;
  referrer?: string | undefined;
  pageUrl?: string | undefined;
  pageTitle?: string | undefined;
  /** Turnstile token of a new visitor's first upload, when the challenge is on. */
  turnstileToken?: string | undefined;
}

/** An attachment of this site: already permanent, or temporary and moved on send. */
type OwnUpload = { url: string } | { temporaryKey: string; key: string };

/** Public site keys are `wk_` + 22 base62 characters (see channel module); anything else cannot exist. */
const SITE_KEY = /^wk_[0-9A-Za-z]{22}$/;
const cut = (value: string | undefined, max: number): string | null =>
  value ? value.slice(0, max) : null;

/** True when the site asks for a phone number and this visitor has sent enough messages without one. */
const phoneRequired = (
  site: WebsiteSite,
  visitor: { phoneE164: string | null; messageCount: number } | null,
): boolean =>
  site.settings.requirePhoneAfter > 0 &&
  visitor !== null &&
  !visitor.phoneE164 &&
  visitor.messageCount >= site.settings.requirePhoneAfter;

@Injectable()
export class WebchatService {
  readonly #sites = new Map<string, { at: number; site: WebsiteSite | null }>();
  readonly #language = new Map<string, { at: number; value: 'vi' | 'en' }>();
  readonly #logger = new Logger(WebchatService.name);
  /** Per-process secret: hashed IPs cannot be matched outside this process or after a day. */
  readonly #ipSecret = randomBytes(16);

  constructor(
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
    @Inject(VISITOR_STORE) private readonly visitors: VisitorStore,
    @Inject(WEBCHAT_UPLOAD_STORAGE) private readonly storage: WebchatUploadStorage,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(WEBCHAT_OPTIONS)
    @Optional()
    private readonly options: WebchatOptions = DEFAULT_WEBCHAT_OPTIONS,
  ) {}

  /** The site when it exists, is on and the Origin belongs to it; otherwise the uniform 404. */
  async site(key: string, origin: string | undefined, ip: string): Promise<WebsiteSite> {
    const site = SITE_KEY.test(key) ? await this.lookup(key, ip) : null;
    if (!site || site.status !== 'connected' || !this.channels.isOriginAllowed(site, origin))
      throw new WidgetError(404, 'NOT_FOUND');
    return site;
  }

  /**
   * Cached `resolveWebsite`; a site edit (disable, domains) is visible after at most SITE_TTL_MS.
   * Only a miss, which runs a DB query, is charged to the caller's address: a shared address that
   * merely polls a live site is never starved by it, while random keys from one address stop at 429.
   */
  private async lookup(key: string, ip: string): Promise<WebsiteSite | null> {
    const hit = this.#sites.get(key);
    if (hit && Date.now() - hit.at < SITE_TTL_MS) return hit.site;
    await this.limit(`ip:${this.ipHash(ip)}:c`, 300, 10 * MINUTE);
    const site = await this.channels.resolveWebsite(key);
    if (this.#sites.size >= SITE_CACHE_MAX) this.#sites.clear();
    this.#sites.set(key, { at: Date.now(), site });
    return site;
  }

  /** Forgets cached site lookups (tests, and anything that must see an edit at once). */
  clearSiteCache(): void {
    this.#sites.clear();
  }

  /** Preflight answer: only an allowed origin of a live site passes. */
  async preflightAllowed(key: string, origin: string | undefined, ip: string): Promise<boolean> {
    return this.site(key, origin, ip).then(
      () => true,
      (error: unknown) => {
        if (error instanceof WidgetError && error.status === 429) throw error;
        return false;
      },
    );
  }

  async config(call: PublicCall): Promise<WidgetConfigDto> {
    const site = await this.site(call.key, call.origin, call.ip);
    const s = site.settings;
    return {
      color: s.color,
      position: s.position,
      agentName: s.agentName,
      avatarUrl: s.avatarUrl,
      greeting: s.greeting,
      phonePrompt: s.phonePrompt,
      phoneChipText: s.phoneChipText,
      language: await this.languageOf(site),
      ...(this.options.captcha ? { turnstileSiteKey: this.options.captcha.siteKey } : {}),
    };
  }

  async send(call: PublicCall, rawBody: unknown): Promise<WidgetSendResponse> {
    const site = await this.site(call.key, call.origin, call.ip);
    const parsed = WidgetSendRequest.safeParse(rawBody);
    if (!parsed.success) throw new WidgetError(400, 'VALIDATION_FAILED');
    const body = parsed.data;
    const existing = call.authorization ? await this.visitorOf(site, call.authorization) : null;
    const existingToken = call.authorization?.slice('Visitor '.length).trim() ?? '';
    await this.limit(`ip:${site.connectionId}:${this.ipHash(call.ip)}:m`, 120, 10 * MINUTE);
    if (!existing) await this.limit(`site:${site.connectionId}:new`, 120, MINUTE);
    const visitorId = existing ?? newId();
    await this.limit(`v:${visitorId}:burst`, 5, 5 * SECOND);
    await this.limit(`v:${visitorId}:h`, 60, HOUR);
    if (!existing) await this.challenge(body.turnstileToken);
    const upload = body.attachmentUrl ? this.ownUpload(site, body.attachmentUrl) : null;
    if (body.attachmentUrl && !upload) throw new WidgetError(400, 'INVALID_ATTACHMENT');

    // Leads come from the visitor's second message on (security audit #2): one anonymous message
    // never creates a CRM customer. A number left in the first message is picked up then.
    const prior = existing
      ? await this.visitors.find(site.workspaceId, site.connectionId, visitorId)
      : null;
    const leadAllowed = (prior?.messageCount ?? 0) >= 1;
    const ownPhone = body.text ? findVnPhone(body.text) : null;
    let typedPhone = leadAllowed ? ownPhone : null;
    let typedEmail = leadAllowed && body.text ? findEmail(body.text) : null;
    if (leadAllowed && prior && !prior.contactId && (!typedPhone || !typedEmail)) {
      const earlier = await this.earlierContact(site, visitorId);
      typedPhone ??= earlier.phone;
      typedEmail ??= earlier.email;
    }
    // A number typed in the message is accepted even while a phone is required (it satisfies it).
    if (existing && !ownPhone && !typedPhone && phoneRequired(site, prior))
      throw new WidgetError(409, 'PHONE_REQUIRED');
    const attachmentUrl = upload ? await this.promote(upload) : undefined;

    await this.visitors.recordMessage(site.workspaceId, site.connectionId, visitorId, {
      firstUrl: cut(body.firstUrl ?? body.page.url, 1000),
      referrer: cut(body.referrer, 500),
      lastUrl: body.page.url.slice(0, 500),
      lastTitle: body.page.title.slice(0, 150),
    });
    const visitorToken = existing
      ? existingToken
      : await this.channels.signVisitorToken(site, visitorId);

    // A phone and an email left in one message end on one customer: the phone is captured first.
    const leadUrl = cut(body.firstUrl ?? body.page.url, 1000);
    if (typedPhone) await this.capture(site, visitorId, { phone: typedPhone }, leadUrl);
    if (typedEmail) await this.capture(site, visitorId, { email: typedEmail }, leadUrl);

    const occurredAt = new Date();
    const event: NormalizedEvent = {
      kind: 'website',
      assetExternalId: site.siteKey,
      // Namespaced per visitor: another visitor reusing this clientMessageId cannot suppress it.
      externalEventId: `${visitorId}:${body.clientMessageId}`,
      externalMessageId: body.clientMessageId,
      type: 'message',
      senderExternalId: visitorId,
      occurredAt,
      ...(body.text ? { text: body.text } : {}),
      ...(attachmentUrl ? { attachments: [{ type: 'image' as const, url: attachmentUrl }] } : {}),
      page: body.page,
      raw: { page: body.page, seen: body.seen ?? [] },
    };
    // A retry of the same clientMessageId is accepted again without a second queue row.
    if (await this.channels.enqueueWebsiteEvent(site, event))
      await this.visitors.countMessage(site.workspaceId, site.connectionId, visitorId);
    return {
      visitorToken,
      message: {
        id: body.clientMessageId,
        role: 'customer',
        text: body.text ?? '',
        imageUrl: attachmentUrl ?? null,
        clientMessageId: body.clientMessageId,
        at: occurredAt.toISOString(),
      },
    };
  }

  async poll(call: PublicCall, after: string | undefined): Promise<WidgetPollResponse> {
    const site = await this.site(call.key, call.origin, call.ip);
    if (after !== undefined && !isUuid(after)) throw new WidgetError(400, 'VALIDATION_FAILED');
    const visitorId = await this.requireVisitor(site, call.authorization);
    await this.limit(`ip:${site.connectionId}:${this.ipHash(call.ip)}:p`, 2400, 10 * MINUTE);
    await this.limit(`v:${visitorId}:p`, 300, 10 * MINUTE);
    const [page, typing, visitor] = await Promise.all([
      this.conversations.listForVisitor(
        site.workspaceId,
        site.connectionId,
        visitorId,
        after ?? null,
      ),
      this.channels.hasPendingCustomerEvent(site.connectionId, visitorId),
      this.visitors.find(site.workspaceId, site.connectionId, visitorId),
    ]);
    if (page.conversationId && visitor && !visitor.conversationId) {
      // The phone arrived with the first message, before the inbox had a conversation to flag. The
      // visitor row learns the conversation only after the lead is linked, so a failure is retried.
      const linked =
        (!visitor.phoneE164 && !visitor.email) ||
        !visitor.contactId ||
        (await this.linkLead(
          site,
          page.conversationId,
          { phone: visitor.phoneE164, email: visitor.email },
          visitor.contactId,
        ));
      if (linked)
        await this.visitors.linkConversation(
          site.workspaceId,
          site.connectionId,
          visitorId,
          page.conversationId,
        );
    }
    return {
      messages: page.messages,
      botTyping: typing,
      phoneCaptured: Boolean(visitor?.phoneE164),
      phoneRequired: phoneRequired(site, visitor),
    };
  }

  /**
   * One image. Without a visitor token the upload starts the visitor exactly like a first message
   * (same new-visitor limits and row fields) and answers with its `visitorToken`.
   */
  async upload(
    call: PublicCall,
    readBytes: () => Promise<Buffer>,
    context: UploadContext = {},
  ): Promise<WidgetUploadResponse> {
    const site = await this.site(call.key, call.origin, call.ip);
    const existing = call.authorization ? await this.visitorOf(site, call.authorization) : null;
    if (!this.storage.available()) throw new WidgetError(503, 'UNAVAILABLE');
    if (!existing) {
      await this.limit(`ip:${site.connectionId}:${this.ipHash(call.ip)}:m`, 120, 10 * MINUTE);
      await this.limit(`site:${site.connectionId}:new`, 120, MINUTE);
    }
    const visitorId = existing ?? newId();
    await this.limit(`v:${visitorId}:up`, 10, HOUR);
    await this.limit(`ip:${this.ipHash(call.ip)}:up`, 60, HOUR);
    if (!existing) await this.challenge(context.turnstileToken);
    // The body is read only after the visitor and the limits passed.
    const bytes = await readBytes();
    if (bytes.length > MAX_UPLOAD_BYTES) throw new WidgetError(413, 'TOO_LARGE');
    const mime = sniffUpload(bytes);
    if (!mime) throw new WidgetError(415, 'UNSUPPORTED_MEDIA');
    // Charged only for a real image, so rejected files do not use up the site's day.
    if (this.options.uploadsPerSiteDay > 0)
      await this.limit(`site:${site.connectionId}:up:d`, this.options.uploadsPerSiteDay, DAY);
    // Stored under the temporary prefix until a message references it (promoted on send).
    const key = `${this.temporaryPrefix(site)}${newId()}.${UPLOAD_EXTENSIONS[mime]}`;
    let url: string;
    try {
      url = await this.storage.put(key, bytes, mime);
    } catch (error) {
      if (error instanceof WebchatStorageUnavailableError)
        throw new WidgetError(503, 'UNAVAILABLE');
      throw error;
    }
    if (existing) return { url };
    const pageUrl = cut(context.pageUrl, 500) ?? '';
    await this.visitors.recordMessage(site.workspaceId, site.connectionId, visitorId, {
      firstUrl: cut(context.firstUrl ?? context.pageUrl, 1000),
      referrer: cut(context.referrer, 500),
      lastUrl: pageUrl,
      lastTitle: (context.pageTitle ?? '').slice(0, 150),
    });
    return { url, visitorToken: await this.channels.signVisitorToken(site, visitorId) };
  }

  /** The visitor leaves a phone number (chip or phone-only mode). Invalid numbers answer 422. */
  async phone(call: PublicCall, rawBody: unknown): Promise<{ phoneCaptured: true }> {
    const site = await this.site(call.key, call.origin, call.ip);
    const visitorId = await this.requireVisitor(site, call.authorization);
    await this.limit(`ip:${this.ipHash(call.ip)}:ph`, 30, HOUR);
    await this.limit(`v:${visitorId}:ph`, 10, HOUR);
    const parsed = WidgetPhoneRequest.safeParse(rawBody);
    if (!parsed.success) throw new WidgetError(400, 'VALIDATION_FAILED');
    const phone = normalizeLeadPhone(parsed.data.phone);
    if (!phone) throw new WidgetError(422, 'INVALID_PHONE');
    const visitor = await this.visitors.find(site.workspaceId, site.connectionId, visitorId);
    if (!visitor) throw new WidgetError(401, 'INVALID_VISITOR');
    await this.capture(site, visitorId, { phone }, visitor.firstUrl);
    return { phoneCaptured: true };
  }

  /**
   * One capture: customer in the CRM (found by phone or email, or created), the contact on the
   * visitor, lead flag on the conversation. Repeating it with the same value changes nothing; a new
   * number replaces the visitor's lead (the earlier customer is left alone). The visitor's earlier
   * customer is passed along, so a phone and an email of one visitor end on one customer.
   */
  private async capture(
    site: WebsiteSite,
    visitorId: string,
    key: { phone: string } | { email: string },
    firstUrl: string | null,
  ): Promise<void> {
    const visitor = await this.visitors.find(site.workspaceId, site.connectionId, visitorId);
    if (!visitor) return;
    const ws = site.workspaceId;
    const earlier = visitor.contactId ? { contactId: visitor.contactId } : {};
    let contactId: string | null;
    if ('phone' in key) {
      contactId = visitor.phoneE164 === key.phone ? visitor.contactId : null;
      if (!contactId) {
        const lead = await this.crm.upsertLeadByPhone(ws, {
          phoneE164: key.phone,
          sourceKey: 'website',
          displayName: websiteLeadName(key.phone),
          firstUrl,
          ...earlier,
        });
        contactId = lead.contactId;
        await this.visitors.recordPhone(ws, site.connectionId, visitorId, key.phone, contactId);
        this.#logger.log(`website lead captured ${maskPhone(key.phone)} (created=${lead.created})`);
      }
    } else {
      contactId = visitor.email === key.email ? visitor.contactId : null;
      if (!contactId) {
        const lead = await this.crm.upsertLeadByEmail(ws, {
          email: key.email,
          sourceKey: 'website',
          displayName: websiteEmailLeadName(key.email),
          firstUrl,
          ...earlier,
        });
        contactId = lead.contactId;
        await this.visitors.recordEmail(ws, site.connectionId, visitorId, key.email, contactId);
        this.#logger.log(`website lead captured ${maskEmail(key.email)} (created=${lead.created})`);
      }
    }
    let conversationId = visitor.conversationId;
    if (!conversationId) {
      // The first message may have been processed since the visitor row was last updated.
      conversationId = (
        await this.conversations.listForVisitor(ws, site.connectionId, visitorId, null, 1)
      ).conversationId;
    }
    if (!conversationId) return;
    const contact = {
      phone: 'phone' in key ? key.phone : visitor.phoneE164,
      email: 'email' in key ? key.email : visitor.email,
    };
    // The visitor row only learns the conversation once the lead is on it: a failed link is retried by the poll.
    if (!(await this.linkLead(site, conversationId, contact, contactId))) return;
    if (!visitor.conversationId)
      await this.visitors.linkConversation(ws, site.connectionId, visitorId, conversationId);
  }

  private async linkLead(
    site: WebsiteSite,
    conversationId: string,
    contact: { phone: string | null; email: string | null },
    contactId: string,
  ): Promise<boolean> {
    try {
      await this.conversations.linkLead(site.workspaceId, conversationId, {
        contactId,
        phoneE164: contact.phone,
        email: contact.email,
        capturedAt: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      // A conversation that vanished must not fail the visitor's request; the CRM contact exists.
      this.#logger.warn(`linking a website lead failed: ${(error as Error).message}`);
      return false;
    }
  }

  /** Deletes uploads no message referenced within `TEMPORARY_UPLOAD_TTL_MS` (worker job). */
  async purgeTemporaryUploads(now: Date = new Date()): Promise<number> {
    if (!this.storage.available()) return 0;
    return this.storage.purge(
      TEMPORARY_UPLOAD_ROOT,
      new Date(now.getTime() - TEMPORARY_UPLOAD_TTL_MS),
    );
  }

  private uploadPrefix(site: WebsiteSite): string {
    return `webchat/${site.workspaceId}/${site.connectionId}/`;
  }

  private temporaryPrefix(site: WebsiteSite): string {
    return `${TEMPORARY_UPLOAD_ROOT}${site.workspaceId}/${site.connectionId}/`;
  }

  /**
   * Visitors may only attach pictures that this site's upload route produced (exact URL shape):
   * a temporary upload (moved to the permanent prefix on send), or an already permanent one (a
   * retried send, or an upload made before temporary uploads existed).
   */
  private ownUpload(site: WebsiteSite, raw: string): OwnUpload | null {
    const prefix = this.storage.publicPrefix();
    if (prefix === null) return null;
    try {
      const base = new URL(prefix);
      const u = new URL(raw);
      if (u.origin !== base.origin || u.search || u.hash || u.username || u.password) return null;
      const basePath = base.pathname.replace(/\/$/, '');
      const file = (dir: string): string | null => {
        const own = `${basePath}/${dir}`;
        if (!u.pathname.startsWith(own)) return null;
        const name = u.pathname.slice(own.length);
        return /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(name) ? name : null;
      };
      if (file(this.uploadPrefix(site))) return { url: raw };
      const temporary = file(this.temporaryPrefix(site));
      if (!temporary) return null;
      return {
        temporaryKey: `${this.temporaryPrefix(site)}${temporary}`,
        key: `${this.uploadPrefix(site)}${temporary}`,
      };
    } catch {
      return null;
    }
  }

  private async promote(upload: OwnUpload): Promise<string> {
    if ('url' in upload) return upload.url;
    try {
      return await this.storage.promote(upload.temporaryKey, upload.key);
    } catch (error) {
      if (error instanceof WebchatStorageUnavailableError)
        throw new WidgetError(400, 'INVALID_ATTACHMENT');
      throw error;
    }
  }

  /** A new visitor's challenge, when Turnstile is on (off by default). */
  private async challenge(token: string | undefined): Promise<void> {
    const captcha = this.options.captcha;
    if (!captcha) return;
    if (!token || !(await captcha.verify(token))) throw new WidgetError(403, 'CHALLENGE_REQUIRED');
  }

  /** The first phone and email in the visitor's earlier customer messages. */
  private async earlierContact(
    site: WebsiteSite,
    visitorId: string,
  ): Promise<{ phone: string | null; email: string | null }> {
    const page = await this.conversations.listForVisitor(
      site.workspaceId,
      site.connectionId,
      visitorId,
      null,
      LEAD_SCAN_MESSAGES,
    );
    let phone: string | null = null;
    let email: string | null = null;
    for (const m of page.messages) {
      if (m.role !== 'customer' || !m.text) continue;
      phone ??= findVnPhone(m.text);
      email ??= findEmail(m.text);
    }
    return { phone, email };
  }

  private async visitorOf(site: WebsiteSite, authorization: string): Promise<string> {
    const token = authorization.startsWith('Visitor ') ? authorization.slice(8).trim() : '';
    const visitorId = token ? await this.channels.verifyVisitorToken(site, token) : null;
    if (!visitorId) throw new WidgetError(401, 'INVALID_VISITOR');
    return visitorId;
  }

  private async requireVisitor(site: WebsiteSite, authorization: string | undefined) {
    if (!authorization) throw new WidgetError(401, 'INVALID_VISITOR');
    return this.visitorOf(site, authorization);
  }

  private async limit(key: string, limit: number, windowMs: number): Promise<void> {
    const r = await this.limiter.hit(key, limit, windowMs);
    if (!r.ok)
      throw new WidgetError(429, 'RATE_LIMITED', Math.max(1, Math.ceil(r.retryAfterMs / 1000)));
  }

  /** Salted per day: the same address maps to one key for a day, never to a stored identifier. */
  private ipHash(ip: string): string {
    const day = new Date().toISOString().slice(0, 10);
    return createHash('sha256')
      .update(this.#ipSecret)
      .update(`${day}|${ip}`)
      .digest('hex')
      .slice(0, 32);
  }

  private async languageOf(site: WebsiteSite): Promise<'vi' | 'en'> {
    if (!site.botId) return 'vi';
    const hit = this.#language.get(site.botId);
    if (hit && Date.now() - hit.at < LANGUAGE_TTL_MS) return hit.value;
    const value = await this.bots.getBot(site.workspaceId, site.botId).then(
      (bot) => (bot.language === 'en' ? ('en' as const) : ('vi' as const)),
      () => 'vi' as const,
    );
    if (this.#language.size >= LANGUAGE_CACHE_MAX) this.#language.clear();
    this.#language.set(site.botId, { at: Date.now(), value });
    return value;
  }
}
