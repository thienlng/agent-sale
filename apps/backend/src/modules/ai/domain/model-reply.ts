import { z } from 'zod';

/** What the model must return (structured output); validated again after parsing. */
export const ModelReply = z.object({
  outcome: z.enum(['answer', 'unknown', 'handoff']),
  reply: z.string(),
  sources: z.array(z.string()),
  /** Ids from the "Images you may send" list; the server validates them (max 3 are sent). */
  imageIds: z.array(z.string()).default([]),
});
export type ModelReply = z.infer<typeof ModelReply>;

/** Why a model output was rejected. A category only: never any text of the output. */
export type InvalidOutputReason = 'empty' | 'not_json' | 'schema';

export type ParsedModelReply =
  { ok: true; value: ModelReply } | { ok: false; reason: InvalidOutputReason };

/** The JSON object inside a ```json fence or surrounded by prose, or the text itself. */
function jsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const out = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  if (fenced) out.push(fenced.trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) out.push(trimmed.slice(start, end + 1));
  return out;
}

/**
 * Parses the model output. Tolerates formatting variants (a code fence or a sentence around the
 * JSON object) but never relaxes the schema: the object must still match `ModelReply` exactly.
 */
export function parseModelReply(text: string): ParsedModelReply {
  if (!text.trim()) return { ok: false, reason: 'empty' };
  let reason: InvalidOutputReason = 'not_json';
  for (const candidate of jsonCandidates(text)) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = ModelReply.safeParse(json);
    if (parsed.success) return { ok: true, value: parsed.data };
    reason = 'schema';
  }
  return { ok: false, reason };
}
