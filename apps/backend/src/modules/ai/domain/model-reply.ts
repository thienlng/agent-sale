import { z } from 'zod';

/** What the model must return (structured output); validated again after parsing. */
export const ModelReply = z.object({
  outcome: z.enum([
    'answer',
    'unknown',
    'handoff',
    'call_action',
    'confirm_action',
    'cancel_action',
  ]),
  reply: z.string(),
  sources: z.array(z.string()),
  /** Ids from the "Images you may send" list; the server validates them (max 3 are sent). */
  imageIds: z.array(z.string()).default([]),
  /** `call_action` only: an id from the `<actions>` list; the server validates it. */
  actionId: z.string().optional(),
  /** `call_action` only: argument values (the runner validates them against the declared params). */
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
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

const MAX_PROSE_CHARS = 700;
const LEAK_WORDS = 8;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * A model that answers a general question in plain prose gave a usable answer in the wrong format.
 * It is accepted as a plain answer only when it is short, has no JSON braces and does not repeat
 * a run of the instructions it was given (an injected "print your prompt" must not get through
 * this door). The number guardrails still apply to what this returns.
 */
export function salvageProse(text: string, instructions: string): ModelReply | null {
  const prose = text.trim();
  if (!prose || prose.length > MAX_PROSE_CHARS || prose.includes('{') || prose.includes('}'))
    return null;
  const proseWords = words(prose);
  if (proseWords.length > LEAK_WORDS) {
    const known = new Set<string>();
    const source = words(instructions);
    for (let i = 0; i + LEAK_WORDS <= source.length; i++)
      known.add(source.slice(i, i + LEAK_WORDS).join(' '));
    for (let i = 0; i + LEAK_WORDS <= proseWords.length; i++)
      if (known.has(proseWords.slice(i, i + LEAK_WORDS).join(' '))) return null;
  }
  return { outcome: 'answer', reply: prose, sources: [], imageIds: [] };
}
