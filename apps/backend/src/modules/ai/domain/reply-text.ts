import { foldVietnamese } from '@agent-sales/shared';

/**
 * Models sometimes double-escape line breaks, so the customer would read a literal `\n`. A sales
 * chat reply has no legitimate use for that sequence (no code, no file paths), so every
 * stand-alone `\n` or `\r\n` becomes a line break; only `\\n` (an escaped backslash) stays. One
 * linear regex pass (T-135).
 */
export function unescapeLineBreaks(reply: string): string {
  return reply.includes('\\') ? reply.replace(/(?<!\\)\\(?:r\\)?n/g, '\n') : reply;
}

/** The model's free-text answer as it may be sent: literal `\n` fixed, outer whitespace trimmed. */
export function normalizeReplyText(text: string): string {
  return unescapeLineBreaks(text).trim();
}

const QUOTE_WORDS = 6;

const words = (text: string): string[] =>
  foldVietnamese(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Knowledge entries the sent text quotes: the whole answer, or a run of 6 consecutive words of it.
 * Free-text answers cite nothing, so "used" is what the customer actually read.
 */
export function quotedSources(
  sent: string,
  sources: readonly { key: string; answer: string }[],
): Set<string> {
  const said = ` ${words(sent).join(' ')} `;
  const used = new Set<string>();
  for (const source of sources) {
    const answer = words(source.answer);
    if (!answer.length) continue;
    const runs =
      answer.length <= QUOTE_WORDS
        ? [answer]
        : Array.from({ length: answer.length - QUOTE_WORDS + 1 }, (_, i) =>
            answer.slice(i, i + QUOTE_WORDS),
          );
    if (runs.some((run) => said.includes(` ${run.join(' ')} `))) used.add(source.key);
  }
  return used;
}
