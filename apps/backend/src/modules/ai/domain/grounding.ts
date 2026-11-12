import { escapeTags, fillPlaceholders, placeholdersIn } from '@agent-sales/shared';

/** A retrieved FAQ the model may cite, keyed by a short id (kb:1…) instead of a UUID. */
export interface KnowledgeSource {
  key: string;
  faqId: string;
  question: string;
  answer: string;
  score: number;
}

/**
 * Turns search hits into citable sources: placeholders are filled with the
 * bot's values, and an entry that still has an unfilled placeholder is
 * dropped — the bot must never quote "{{store.address}}" or guess it.
 */
export function toSources(
  hits: ReadonlyArray<{ id: string; question: string; answer: string; score: number }>,
  placeholders: Readonly<Record<string, string>>,
): KnowledgeSource[] {
  const sources: KnowledgeSource[] = [];
  for (const hit of hits) {
    const question = fillPlaceholders(hit.question, placeholders);
    const answer = fillPlaceholders(hit.answer, placeholders);
    if (placeholdersIn(question).length || placeholdersIn(answer).length) continue;
    sources.push({
      key: `kb:${sources.length + 1}`,
      faqId: hit.id,
      question,
      answer,
      score: hit.score,
    });
  }
  return sources;
}

/**
 * The per-turn knowledge block. Content is data, delimited for the model (docs/06 §3.3); entries
 * can come from crawled pages and uploaded files, so `<` is escaped and no entry can close the
 * block or open a tag of its own (same rule as `<business_profile>`).
 */
export function knowledgeBlock(sources: readonly KnowledgeSource[]): string {
  if (!sources.length) return '<knowledge>\n(no matching entries)\n</knowledge>';
  const entries = sources.map(
    (s) => `[${s.key}]\nQ: ${escapeTags(s.question)}\nA: ${escapeTags(s.answer)}`,
  );
  return `<knowledge>\n${entries.join('\n\n')}\n</knowledge>`;
}

/** Number grounding lives in the shared kernel (the care agent checks its messages too). */
export { ungroundedFigures } from '@agent-sales/shared';
