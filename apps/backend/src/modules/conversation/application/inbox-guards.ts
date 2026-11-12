import { TenantFairness, type BucketStore } from '@agent-sales/queue';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Limiter } from '../../../common/limits/limiter.js';

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
  /** AI replies to anonymous website visitors (no captured lead), per site and per workspace. */
  anonymousSiteHour: number;
  anonymousSiteDay: number;
  anonymousWorkspaceHour: number;
  anonymousWorkspaceDay: number;
}

export type CapScope = 'site' | 'workspace';
export type CapWindow = 'hour' | 'day';

/** Which anonymous-reply cap a website reply hit. */
export interface AnonymousCap {
  scope: CapScope;
  window: CapWindow;
  /** Start of the window (ms), so the owner is told once per window. */
  windowStart: number;
}

/** Tells the owner that a cap was reached (once per window; best effort). */
export type CapNotifier = (ws: WorkspaceId, cap: AnonymousCap) => Promise<void>;

/** Nest token of the processor's guards; absent = no caps, one conversation at a time. */
export const INBOX_GUARDS = Symbol('INBOX_GUARDS');

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
   * over), then, for an anonymous website visitor, the site and workspace caps (`anonymous`).
   */
  async replyCap(
    ws: WorkspaceId,
    conversationId: string,
    connectionId: string,
    visitor: { anonymous: boolean },
  ): Promise<'handoff' | 'anonymous' | null> {
    if (!(await this.conversationReply(ws, conversationId))) return 'handoff';
    if (!visitor.anonymous) return null;
    return (await this.anonymousReply(ws, connectionId)) ? 'anonymous' : null;
  }

  /** Counts one bot reply of the conversation; false once the hourly cap is spent. */
  async conversationReply(ws: WorkspaceId, conversationId: string): Promise<boolean> {
    const limit = this.limits.botRepliesPerConversationHour;
    if (!limit) return true;
    return (await this.limiter.hit(`inbox:conv:${ws}:${conversationId}:replies`, limit, HOUR)).ok;
  }

  /**
   * Counts one AI reply to an anonymous website visitor against the site and workspace caps.
   * Null when every cap still has room, otherwise the first cap that is spent.
   */
  async anonymousReply(ws: WorkspaceId, connectionId: string): Promise<AnonymousCap | null> {
    const l = this.limits;
    const checks: [CapScope, CapWindow, string, number, number][] = [
      ['site', 'hour', `inbox:anon:site:${connectionId}:h`, l.anonymousSiteHour, HOUR],
      ['site', 'day', `inbox:anon:site:${connectionId}:d`, l.anonymousSiteDay, DAY],
      ['workspace', 'hour', `inbox:anon:ws:${ws}:h`, l.anonymousWorkspaceHour, HOUR],
      ['workspace', 'day', `inbox:anon:ws:${ws}:d`, l.anonymousWorkspaceDay, DAY],
    ];
    for (const [scope, window, key, limit, windowMs] of checks) {
      if (!limit) continue;
      if ((await this.limiter.hit(key, limit, windowMs)).ok) continue;
      const now = this.clock();
      const cap = { scope, window, windowStart: now - (now % windowMs) };
      await this.notifyOnce(ws, scope === 'site' ? connectionId : ws, cap, windowMs);
      return cap;
    }
    return null;
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
    subject: string,
    cap: AnonymousCap,
    windowMs: number,
  ): Promise<void> {
    if (!this.notify) return;
    const key = `inbox:anon:notified:${subject}:${cap.scope}:${cap.window}`;
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
  WEBCHAT_AI_REPLIES_SITE_HOUR: number;
  WEBCHAT_AI_REPLIES_SITE_DAY: number;
  WEBCHAT_AI_REPLIES_WORKSPACE_HOUR: number;
  WEBCHAT_AI_REPLIES_WORKSPACE_DAY: number;
}): InboxLimits {
  return {
    concurrency: env.INBOX_CONCURRENCY,
    claimPerWorkspace: env.INBOX_CLAIM_PER_WORKSPACE,
    turnsPerWorkspaceMinute: env.INBOX_TURNS_WORKSPACE_MINUTE,
    turnsBurst: env.INBOX_TURNS_WORKSPACE_BURST,
    botRepliesPerConversationHour: env.CONVERSATION_BOT_REPLIES_HOUR,
    anonymousSiteHour: env.WEBCHAT_AI_REPLIES_SITE_HOUR,
    anonymousSiteDay: env.WEBCHAT_AI_REPLIES_SITE_DAY,
    anonymousWorkspaceHour: env.WEBCHAT_AI_REPLIES_WORKSPACE_HOUR,
    anonymousWorkspaceDay: env.WEBCHAT_AI_REPLIES_WORKSPACE_DAY,
  };
}
