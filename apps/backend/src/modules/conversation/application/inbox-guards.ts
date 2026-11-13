import { TenantFairness, type BucketStore } from '@agent-sales/queue';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Limiter, WindowCheck } from '../../../common/limits/limiter.js';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Abuse and fairness limits of the bot inbox (security audit 2026-11-12 #2, #3, #18). 0 = off. */
export interface InboxLimits {
  /** Conversations answered at the same time by one agent process (≥ 1). */
  concurrency: number;
  /** Distinct conversations per workspace in one claim. */
  claimPerWorkspace: number;
  /** Bot turns per workspace and minute (token bucket), and its burst. */
  turnsPerWorkspaceMinute: number;
  turnsBurst: number;
  /** Bot replies per conversation and hour; past it, staff take over. */
  botRepliesPerConversationHour: number;
  /** Bot replies per customer (CRM contact) and hour, across all of its conversations. */
  botRepliesPerContactHour: number;
  /**
   * AI replies to website visitors, per site and per workspace. Every website reply counts
   * against these windows: a visitor without a lead or contact (anonymous) may use only this
   * much, while all website replies together may use `knownVisitorFactor` times as much. A typed
   * (possibly fake) phone number raises the ceiling for that visitor, it never removes it.
   */
  anonymousSiteHour: number;
  anonymousSiteDay: number;
  anonymousWorkspaceHour: number;
  anonymousWorkspaceDay: number;
  /** All website replies may use this multiple of the anonymous budget (≥ 1). */
  knownVisitorFactor: number;
}

export type CapScope = 'site' | 'workspace';
export type CapWindow = 'hour' | 'day';

/** Which website-reply cap a reply hit. */
export interface AnonymousCap {
  scope: CapScope;
  window: CapWindow;
  /** Start of the window (ms), so the owner is told once per window. */
  windowStart: number;
}

/** Who a bot reply goes to, as far as the caps are concerned. */
export interface ReplyVisitor {
  /** A website-chat visitor: the site and workspace windows apply. */
  website: boolean;
  /** No captured lead and no CRM contact on the conversation. */
  anonymous: boolean;
  /** The customer's CRM contact when known (per-contact cap across conversations). */
  contactId: string | null;
}

/** Tells the owner that a cap was reached (once per window; best effort). */
export type CapNotifier = (ws: WorkspaceId, cap: AnonymousCap) => Promise<void>;

/** Nest token of the processor's guards; absent = no caps, one conversation at a time. */
export const INBOX_GUARDS = Symbol('INBOX_GUARDS');

/** One counter of a reply check, and what a refusal on it means. */
interface Check extends WindowCheck {
  cap: 'handoff' | 'capped';
  /** A site or workspace window: the owner is told when it fills. */
  window?: AnonymousCap;
  pool?: 'anon' | 'all';
}

/**
 * Shared-counter checks of the bot inbox. Counters live in the shared limiter (Redis in
 * production) so every agent process sees the same totals.
 */
export class InboxGuards {
  readonly #fairness: TenantFairness | null;

  constructor(
    readonly limits: InboxLimits,
    private readonly limiter: Limiter,
    buckets: BucketStore | null,
    private readonly notify?: CapNotifier,
    private readonly clock: () => number = Date.now,
  ) {
    const perMinute = limits.turnsPerWorkspaceMinute;
    const bucket = { refillPerSecond: perMinute / 60, capacity: Math.max(1, limits.turnsBurst) };
    this.#fairness =
      buckets && perMinute > 0
        ? new TenantFairness(
            buckets,
            { tenant: { free: bucket, standard: bucket, priority: bucket } },
            clock,
          )
        : null;
  }

  /** 0 when the workspace may run a bot turn now, otherwise the delay (ms) to hand it back for. */
  async admitTurn(ws: WorkspaceId): Promise<number> {
    if (!this.#fairness) return 0;
    return this.#fairness.admit({ queue: 'inbox', workspaceId: ws, tier: 'standard' });
  }

  /**
   * The cap a bot reply hits, if any: the conversation's replies per hour (`handoff`: staff take
   * over); else the customer's replies per hour across conversations, or for a website visitor
   * the site and workspace windows (`capped`: a polite message once, no model call). Every cap
   * is checked before any counter moves (`Limiter.hitAll`), so a refused reply spends nothing.
   */
  async replyCap(
    ws: WorkspaceId,
    conversationId: string,
    connectionId: string,
    visitor: ReplyVisitor,
  ): Promise<'handoff' | 'capped' | null> {
    const l = this.limits;
    const checks: Check[] = [];
    if (l.botRepliesPerConversationHour)
      checks.push({
        key: `inbox:conv:${ws}:${conversationId}:replies`,
        limit: l.botRepliesPerConversationHour,
        windowMs: HOUR,
        cap: 'handoff',
      });
    if (l.botRepliesPerContactHour && visitor.contactId)
      checks.push({
        key: `inbox:contact:${ws}:${visitor.contactId}:replies`,
        limit: l.botRepliesPerContactHour,
        windowMs: HOUR,
        cap: 'capped',
      });
    if (visitor.website) checks.push(...this.websiteChecks(ws, connectionId, visitor.anonymous));
    if (!checks.length) return null;
    const { refused } = await this.limiter.hitAll(checks);
    const hit = checks[refused];
    if (!hit) return null;
    if (hit.window) await this.notifyOnce(ws, connectionId, hit.window, hit.pool ?? 'all');
    return hit.cap;
  }

  /**
   * The site and workspace windows of one website reply. Every reply counts in the `all` pool
   * (the anonymous budget × `knownVisitorFactor`); an anonymous one also in the `anon` pool.
   */
  private websiteChecks(ws: WorkspaceId, connectionId: string, anonymous: boolean): Check[] {
    const l = this.limits;
    const factor = Math.max(1, l.knownVisitorFactor);
    const now = this.clock();
    const windows: [CapScope, CapWindow, string, number, number][] = [
      ['site', 'hour', `site:${connectionId}:h`, l.anonymousSiteHour, HOUR],
      ['site', 'day', `site:${connectionId}:d`, l.anonymousSiteDay, DAY],
      ['workspace', 'hour', `ws:${ws}:h`, l.anonymousWorkspaceHour, HOUR],
      ['workspace', 'day', `ws:${ws}:d`, l.anonymousWorkspaceDay, DAY],
    ];
    const checks: Check[] = [];
    for (const [scope, window, key, limit, windowMs] of windows) {
      if (!limit) continue;
      const cap: AnonymousCap = { scope, window, windowStart: now - (now % windowMs) };
      if (anonymous)
        checks.push({
          key: `inbox:anon:${key}`,
          limit,
          windowMs,
          cap: 'capped',
          window: cap,
          pool: 'anon',
        });
      checks.push({
        key: `inbox:web:${key}`,
        limit: limit * factor,
        windowMs,
        cap: 'capped',
        window: cap,
        pool: 'all',
      });
    }
    return checks;
  }

  /**
   * True the first time a capped conversation is seen in the window: it gets the polite message
   * once, later messages wait for staff silently (no bot message per visitor message).
   */
  async firstCappedReply(ws: WorkspaceId, conversationId: string): Promise<boolean> {
    return (await this.limiter.hit(`inbox:anon:told:${ws}:${conversationId}`, 1, DAY)).ok;
  }

  private async notifyOnce(
    ws: WorkspaceId,
    connectionId: string,
    cap: AnonymousCap,
    pool: 'anon' | 'all',
  ): Promise<void> {
    if (!this.notify) return;
    const subject = cap.scope === 'site' ? connectionId : ws;
    const windowMs = cap.window === 'hour' ? HOUR : DAY;
    const key = `inbox:anon:notified:${subject}:${cap.scope}:${cap.window}:${pool}`;
    if (!(await this.limiter.hit(key, 1, windowMs)).ok) return;
    await this.notify(ws, cap).catch(() => undefined);
  }
}

/** The process limits from the environment (see `.env.example`). */
export function inboxLimitsFromEnv(env: {
  INBOX_CONCURRENCY: number;
  INBOX_CLAIM_PER_WORKSPACE: number;
  INBOX_TURNS_WORKSPACE_MINUTE: number;
  INBOX_TURNS_WORKSPACE_BURST: number;
  CONVERSATION_BOT_REPLIES_HOUR: number;
  CONTACT_BOT_REPLIES_HOUR: number;
  WEBCHAT_AI_REPLIES_SITE_HOUR: number;
  WEBCHAT_AI_REPLIES_SITE_DAY: number;
  WEBCHAT_AI_REPLIES_WORKSPACE_HOUR: number;
  WEBCHAT_AI_REPLIES_WORKSPACE_DAY: number;
  WEBCHAT_AI_REPLIES_KNOWN_FACTOR: number;
}): InboxLimits {
  return {
    concurrency: env.INBOX_CONCURRENCY,
    claimPerWorkspace: env.INBOX_CLAIM_PER_WORKSPACE,
    turnsPerWorkspaceMinute: env.INBOX_TURNS_WORKSPACE_MINUTE,
    turnsBurst: env.INBOX_TURNS_WORKSPACE_BURST,
    botRepliesPerConversationHour: env.CONVERSATION_BOT_REPLIES_HOUR,
    botRepliesPerContactHour: env.CONTACT_BOT_REPLIES_HOUR,
    anonymousSiteHour: env.WEBCHAT_AI_REPLIES_SITE_HOUR,
    anonymousSiteDay: env.WEBCHAT_AI_REPLIES_SITE_DAY,
    anonymousWorkspaceHour: env.WEBCHAT_AI_REPLIES_WORKSPACE_HOUR,
    anonymousWorkspaceDay: env.WEBCHAT_AI_REPLIES_WORKSPACE_DAY,
    knownVisitorFactor: env.WEBCHAT_AI_REPLIES_KNOWN_FACTOR,
  };
}
