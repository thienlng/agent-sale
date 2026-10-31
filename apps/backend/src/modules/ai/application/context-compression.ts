import type { ChatMessage } from '@agent-sales/ai-core';

export const COMPRESS_AT_CHARS = 24_000;
export const KEEP_LAST_TURNS = 12;

export interface StoredSummary {
  /** Number of leading turns the summary covers: `turns[0 .. coveredUntilIndex)`. */
  coveredUntilIndex: number;
  summary: string;
}

export function historyChars(turns: readonly ChatMessage[]): number {
  return turns.reduce((n, t) => n + t.content.length, 0);
}

export function needsCompression(
  turns: readonly ChatMessage[],
  maxChars: number = COMPRESS_AT_CHARS,
): boolean {
  return historyChars(turns) > maxChars;
}

export function summaryMessage(summary: string): ChatMessage {
  return {
    role: 'user',
    content: `<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>`,
  };
}

/** Plain-text transcript of turns, the input of the summarizer. */
export function renderTurns(turns: readonly ChatMessage[]): string {
  return turns
    .map((t) => `${t.role === 'assistant' ? 'Assistant' : 'Customer'}: ${t.content}`)
    .join('\n');
}

/**
 * Keeps long histories inside the context budget. Once the history exceeds `maxChars`, turns
 * older than the last `keepLast` are replaced by one summary message at the start. Only turns
 * newer than the stored summary are summarised (merged with it); once a summary exists it keeps
 * being used so the prompt prefix stays stable between turns. `summary` is the value to persist
 * (null when nothing is compressed).
 */
export async function compressHistory(
  turns: readonly ChatMessage[],
  opts: {
    summarize(text: string, previous: string | null): Promise<string>;
    stored: StoredSummary | null;
    maxChars?: number;
    keepLast?: number;
  },
): Promise<{ turns: ChatMessage[]; summary: StoredSummary | null }> {
  const maxChars = opts.maxChars ?? COMPRESS_AT_CHARS;
  const keepLast = opts.keepLast ?? KEEP_LAST_TURNS;
  const stored = opts.stored
    ? { ...opts.stored, coveredUntilIndex: Math.min(opts.stored.coveredUntilIndex, turns.length) }
    : null;

  if (!stored) {
    if (!needsCompression(turns, maxChars)) return { turns: [...turns], summary: null };
  } else {
    const current = [summaryMessage(stored.summary), ...turns.slice(stored.coveredUntilIndex)];
    if (!needsCompression(current, maxChars)) return { turns: current, summary: stored };
  }

  const covered = stored?.coveredUntilIndex ?? 0;
  const windowStart = Math.max(turns.length - keepLast, 0);
  if (windowStart <= covered) {
    // Nothing older than the window is left to fold in.
    return stored
      ? { turns: [summaryMessage(stored.summary), ...turns.slice(covered)], summary: stored }
      : { turns: [...turns], summary: null };
  }
  const summary = await opts.summarize(
    renderTurns(turns.slice(covered, windowStart)),
    stored?.summary ?? null,
  );
  return {
    turns: [summaryMessage(summary), ...turns.slice(windowStart)],
    summary: { coveredUntilIndex: windowStart, summary },
  };
}
