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
  return withoutMetaLines(
    withoutForeignScripts(withoutRepeatedLines(unescapeLineBreaks(text))),
  ).trim();
}

// Scripts a Vietnamese shop chat never uses; the model sometimes leaks a character ("સố", "જો").
const FOREIGN_SCRIPTS =
  /[\p{Script=Gujarati}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}]+/gu;

/** TM-22: stray characters of scripts no Vietnamese chat uses are dropped. */
export function withoutForeignScripts(text: string): string {
  return FOREIGN_SCRIPTS.test(text)
    ? text
        .replace(FOREIGN_SCRIPTS, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,!?])/g, '$1')
    : text;
}

// A line about the message instead of to the customer: the model's own reasoning (TM3-8).
const META_LINE =
  /^\s*(tin nhắn này|câu (này|hỏi này)|khách (đang|muốn|hỏi|vừa|chỉ)|người dùng|this message|the (customer|user) (is|wants|asks))(?![\p{L}])/iu;

/** TM3-8: lines that describe the message ("Tin nhắn này là câu chào…") are not sent. */
export function withoutMetaLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !META_LINE.test(line))
    .join('\n');
}

/**
 * TM-22: the model sometimes writes the same sentence twice in one answer. A line equal to an
 * earlier one (case and spacing ignored) is dropped; blank lines stay as they are.
 */
export function withoutRepeatedLines(text: string): string {
  const seen = new Set<string>();
  return text
    .split('\n')
    .filter((line) => {
      const key = line.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

/** A line as compared for repeats: no "Dạ"/"Vâng" lead, no accents, case, spacing or end mark. */
const lineKey = (line: string): string =>
  foldVietnamese(line)
    .replace(/^\W*(da|vang|yes|ok)\b[\s,]*/u, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * VL-B8: the final answer must not repeat what `send_message` already sent this turn: every line
 * of the answer that a sent message already said (a "Dạ" lead, case and punctuation ignored) is
 * dropped. Returns '' when nothing new is left.
 */
export function withoutSentLines(answer: string, sent: readonly string[]): string {
  const said = new Set(
    sent.flatMap((text) => text.split('\n').map(lineKey)).filter((key) => key.length > 0),
  );
  if (!said.size) return answer;
  return answer
    .split('\n')
    .filter((line) => !said.has(lineKey(line)))
    .join('\n')
    .trim();
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
