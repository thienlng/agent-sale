import type { ConversationDto, InboxMessageDto } from '@agent-sales/contracts';
import type { ReplyResult } from '../../../ai/api/index.js';
import type { BotView } from '../../../bot/api/index.js';
import type { PendingMetaEvent } from '../../../channel/api/index.js';
import type { ConversationFacade } from '../../api/conversation.facade.js';

/** Spec §7: a turn is re-run for newer customer messages at most this often per burst (no starvation). */
export const MAX_INTERRUPT_RERUNS = 3;

/** What an interrupted turn hands to its re-run. */
export interface Resume {
  /** The interrupted run's tool work, passed back to the AI as-is (it already holds earlier carry). */
  carry: ReplyResult['carry'];
  /** Re-runs already started for this burst. */
  reruns: number;
  /**
   * Bot messages stored after this id are covered by `carry` and left out of the history. Without
   * a carry it is the newest message after the previous run, so that run's sends stay history.
   */
  boundary: string;
}

/** A pending re-run older than this is ignored (its burst was answered or abandoned meanwhile). */
const RESUME_TTL_MS = 10 * 60_000;

/** Interrupted turns waiting for their re-run, per conversation (in memory: one agent process). */
export class ResumeStore {
  private readonly pending = new Map<string, Resume & { at: number }>();
  put(ws: string, conversationId: string, resume: Resume): void {
    const now = Date.now();
    for (const [id, entry] of this.pending)
      if (now - entry.at >= RESUME_TTL_MS) this.pending.delete(id);
    this.pending.set(`${ws}/${conversationId}`, { ...resume, at: Date.now() });
  }
  /** Removes and returns the conversation's pending re-run, if still fresh. */
  take(ws: string, conversationId: string): Resume | undefined {
    const id = `${ws}/${conversationId}`;
    const found = this.pending.get(id);
    this.pending.delete(id);
    if (!found || Date.now() - found.at >= RESUME_TTL_MS) return undefined;
    const { at: _at, ...resume } = found;
    return resume;
  }
}

/**
 * The resume a turn starts from, and the history the model gets. A resume is dropped when staff
 * wrote after its boundary (a takeover handed back: that burst is over). With a carry, bot
 * messages after the boundary are left out of the history: the carry already holds them as the
 * interrupted run's send_message calls, so every customer message of the burst is one turn.
 */
export function startTurn(
  taken: Resume | undefined,
  stored: InboxMessageDto[],
): { resume: Resume; history: InboxMessageDto[] } {
  const after = (m: InboxMessageDto, boundary: string) =>
    m.direction === 'outbound' && m.id > boundary;
  const resume =
    taken && !stored.some((m) => after(m, taken.boundary) && m.sender !== 'bot')
      ? taken
      : undefined;
  if (!resume)
    return {
      resume: { carry: undefined, reruns: 0, boundary: stored.at(-1)?.id ?? '' },
      history: stored,
    };
  return {
    resume,
    history: resume.carry
      ? stored.filter((m) => !(after(m, resume.boundary) && m.sender === 'bot'))
      : stored,
  };
}

/**
 * The resume of the next re-run. Only a fresh carry of an interrupted run hides the bot messages
 * it covers; without one, everything sent so far stays in the history as plain bot messages.
 */
export function nextResume(
  resume: Resume,
  freshCarry: ReplyResult['carry'],
  newestId: string,
): Resume {
  return freshCarry
    ? { carry: freshCarry, reruns: resume.reruns + 1, boundary: resume.boundary }
    : { carry: undefined, reruns: resume.reruns + 1, boundary: newestId };
}

/** Everything one answer needs, resolved by `process`. */
export interface Turn {
  job: PendingMetaEvent;
  c: ConversationDto;
  botId: string;
  bot: BotView;
  context: Awaited<ReturnType<ConversationFacade['getReplyContext']>>;
  /** Messages in arrival order, as the model sees them. */
  stored: InboxMessageDto[];
  /** Id of the newest stored message when the turn started. */
  newestId: string;
  key: string;
  resume: Resume;
}
