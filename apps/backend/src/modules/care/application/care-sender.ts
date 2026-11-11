import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CONVERSATION_FACADE,
  type CareRefusal,
  type ConversationFacade,
} from '../../conversation/api/index.js';
import { careSendKey } from '../domain/care.js';
import { CARE_STORE, type CareMessage, type CareStore } from '../domain/ports/care.store.js';

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const codeOf = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;
const REFUSALS: readonly string[] = [
  'conversation_closed',
  'window_closed',
  'customer_replied',
  'taken_over',
] satisfies CareRefusal[];

/**
 * What a send did. `channel_failed`: the channel refused it (`failed`); any other reason: the
 * conversation refused it (the customer wrote after the anchor, a person holds it, it is closed
 * or out of the window) and the care message is `expired`.
 */
export type SendOutcome =
  | { status: 'sent'; messageId: string }
  | { status: 'failed'; reason: CareRefusal | 'channel_failed' };

/**
 * Sends a care message that is in `sending` through the conversation module (a bot message
 * marked `source: 'care'`, never a message tag) with the step's idempotency key
 * (`care:<enrollment>:<anchor>:<step>`) and the anchor, and records the outcome on the care
 * message. Shared by the worker (act levels, scheduled approvals) and by approvals.
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
    m: Pick<CareMessage, 'id' | 'conversationId' | 'text' | 'enrollmentId' | 'anchorAt' | 'step'>,
    actor: string | null,
    now: Date,
  ): Promise<SendOutcome> {
    let outcome: SendOutcome;
    let messageId: string | null = null;
    try {
      const sent = await this.conversations.commitCareMessage(ws, m.conversationId, {
        text: m.text,
        idempotencyKey: careSendKey(m),
        anchorAt: m.anchorAt,
      });
      messageId = sent.id;
      outcome =
        sent.status === 'failed'
          ? { status: 'failed', reason: 'channel_failed' }
          : { status: 'sent', messageId: sent.id };
    } catch (e) {
      const code = codeOf(e);
      const reason = (e as { details?: { reason?: unknown } } | null)?.details?.reason;
      if (code !== 'CONFLICT' && code !== 'NOT_FOUND' && code !== 'VALIDATION_FAILED') {
        this.#log.warn(`care message ${m.id} not sent (${errorClass(e)})`);
      }
      outcome = {
        status: 'failed',
        reason:
          typeof reason === 'string' && REFUSALS.includes(reason)
            ? (reason as CareRefusal)
            : code === 'CONFLICT' || code === 'NOT_FOUND'
              ? 'conversation_closed'
              : 'channel_failed',
      };
    }
    await this.store.finishSend(
      ws,
      m.id,
      {
        status:
          outcome.status === 'sent'
            ? 'sent'
            : outcome.reason === 'channel_failed'
              ? 'failed'
              : 'expired',
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
