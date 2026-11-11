import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import { CARE_STORE, type CareStore } from '../domain/ports/care.store.js';

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const codeOf = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

/** What a send did: `conversation_changed` = closed, out of the window, or gone. */
export type SendOutcome =
  | { status: 'sent'; messageId: string }
  | { status: 'failed'; reason: 'conversation_changed' | 'channel_failed' };

/**
 * Sends a care message that is in `sending` through the conversation module (a bot message
 * marked `source: 'care'`, idempotency key `care:<id>`, never a message tag) and records the
 * outcome on the care message. Shared by the worker (act levels) and by approvals.
 */
@Injectable()
export class CareSender {
  readonly #log = new Logger(CareSender.name);

  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
  ) {}

  async send(
    ws: WorkspaceId,
    m: { id: string; conversationId: string; text: string },
    actor: string | null,
    now: Date,
  ): Promise<SendOutcome> {
    let outcome: SendOutcome;
    let messageId: string | null = null;
    try {
      const sent = await this.conversations.commitCareMessage(ws, m.conversationId, {
        text: m.text,
        idempotencyKey: `care:${m.id}`,
      });
      messageId = sent.id;
      outcome =
        sent.status === 'failed'
          ? { status: 'failed', reason: 'channel_failed' }
          : { status: 'sent', messageId: sent.id };
    } catch (e) {
      const code = codeOf(e);
      if (code !== 'CONFLICT' && code !== 'NOT_FOUND' && code !== 'VALIDATION_FAILED') {
        this.#log.warn(`care message ${m.id} not sent (${errorClass(e)})`);
      }
      outcome = {
        status: 'failed',
        reason:
          code === 'CONFLICT' || code === 'NOT_FOUND' ? 'conversation_changed' : 'channel_failed',
      };
    }
    await this.store.finishSend(
      ws,
      m.id,
      {
        status: outcome.status,
        text: m.text,
        sentMessageId: messageId,
        reason: outcome.status === 'failed' ? outcome.reason : null,
        actor,
      },
      now,
    );
    return outcome;
  }
}
