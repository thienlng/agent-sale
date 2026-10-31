import type { ChatMessage } from '@agent-sales/ai-core';

export const COMPRESS_AT_CHARS = 24_000;
/** More turns than this (not counting the summary) also compress, however short they are. */
export const COMPRESS_AT_TURNS = 30;
export const KEEP_LAST_TURNS = 12;

export interface StoredSummary {
  /** Number of leading turns the summary covers: `turns[0 .. coveredUntilIndex)`. */
  coveredUntilIndex: number;
  summary: string;
}

export function historyChars(turns: readonly ChatMessage[]): number {
  return turns.reduce((n, t) => n + t.content.length, 0);
}

/**
 * The history (the stored summary, when given, plus the turns it does not cover) is over the
 * context budget: more than `maxChars` characters or more than `maxTurns` uncovered turns.
 */
export function needsCompression(
  uncovered: readonly ChatMessage[],
  limits: { summary?: string | null; maxChars?: number; maxTurns?: number } = {},
): boolean {
  const chars = historyChars(uncovered) + (limits.summary?.length ?? 0);
  return (
    chars > (limits.maxChars ?? COMPRESS_AT_CHARS) ||
    uncovered.length > (limits.maxTurns ?? COMPRESS_AT_TURNS)
  );
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
 * Keeps long histories inside the context budget. Once the history (the stored summary plus the
 * turns it does not cover) is over the budget (see `needsCompression`), every turn older than the
 * last `keepLast` is folded into one summary message at the start: the stored summary is merged
 * with all the turns between what it covers and the kept window, so nothing is skipped. While the
 * history fits, a stored summary is reused as is, so the prompt prefix stays stable between turns.
 * `summary` is the value to persist (null when nothing is compressed).
 */
export async function compressHistory(
  turns: readonly ChatMessage[],
  opts: {
    summarize(text: string, previous: string | null): Promise<string>;
    stored: StoredSummary | null;
    maxChars?: number;
    maxTurns?: number;
    keepLast?: number;
  },
): Promise<{ turns: ChatMessage[]; summary: StoredSummary | null }> {
  const keepLast = opts.keepLast ?? KEEP_LAST_TURNS;
  const stored = opts.stored
    ? { ...opts.stored, coveredUntilIndex: Math.min(opts.stored.coveredUntilIndex, turns.length) }
    : null;
  const covered = stored?.coveredUntilIndex ?? 0;
  const current = (): ChatMessage[] =>
    stored ? [summaryMessage(stored.summary), ...turns.slice(covered)] : [...turns];

  const limits = {
    summary: stored?.summary ?? null,
    ...(opts.maxChars !== undefined ? { maxChars: opts.maxChars } : {}),
    ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
  };
  if (!needsCompression(turns.slice(covered), limits)) return { turns: current(), summary: stored };

  const windowStart = Math.max(turns.length - keepLast, 0);
  // Nothing older than the window is left to fold in.
  if (windowStart <= covered) return { turns: current(), summary: stored };
  const summary = await opts.summarize(
    renderTurns(turns.slice(covered, windowStart)),
    stored?.summary ?? null,
  );
  return {
    turns: [summaryMessage(summary), ...turns.slice(windowStart)],
    summary: { coveredUntilIndex: windowStart, summary },
  };
}
