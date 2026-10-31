import type { GenerateRequest, GenerateResponse, ModelTier } from '@agent-sales/ai-core';
import type { WorkspaceId } from '@agent-sales/shared';

export const SUMMARY_MAX_CHARS = 1_500;

const SUMMARIZER_INSTRUCTION = [
  'You compress the earlier part of a sales chat between a customer and a shop assistant into a short memory note for the assistant.',
  'Write the note in Vietnamese, as plain lines, at most 1200 characters.',
  'Keep every concrete fact: products discussed (names, variants, prices), quantities, the customer name, phone numbers, delivery addresses, and decisions or agreements reached.',
  'Drop greetings, small talk and anything already superseded. Never invent facts. If a previous note is given, merge it with the new conversation part into one note.',
  'Output only the note.',
].join('\n');

export function createHistorySummarizer(
  generate: (req: GenerateRequest) => Promise<GenerateResponse>,
  opts: { workspaceId: WorkspaceId; tier: ModelTier },
): (text: string, previous: string | null) => Promise<string> {
  return async (text, previous) => {
    const parts = [
      previous ? `Previous note:\n${previous}` : null,
      `Conversation part to add:\n${text}`,
    ].filter((p): p is string => p !== null);
    const res = await generate({
      workspaceId: opts.workspaceId,
      tier: opts.tier,
      messages: [
        { role: 'system', content: SUMMARIZER_INSTRUCTION },
        { role: 'user', content: parts.join('\n\n') },
      ],
      maxOutputTokens: 800,
    });
    const out = res.text.trim();
    if (!out) throw new Error('history summarizer returned an empty note');
    return capNote(out);
  };
}

/** Cuts an over-long note at the last line break (or sentence end) before the cap. */
function capNote(note: string): string {
  if (note.length <= SUMMARY_MAX_CHARS) return note;
  const head = note.slice(0, SUMMARY_MAX_CHARS);
  const newline = head.lastIndexOf('\n');
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  const cut = newline > 0 ? newline : sentence > 0 ? sentence + 1 : SUMMARY_MAX_CHARS;
  return head.slice(0, cut).trimEnd();
}
