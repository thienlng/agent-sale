/** One owner instruction as the model sees it (a subset of the knowledge module's training item). */
export interface SituationItem {
  title: string;
  trigger?: string | null;
  content: string;
  /** Missing on items from before migration 0016: treated as enabled. */
  enabled?: boolean;
  /** Missing on items from before migration 0016: treated as `general`. */
  section?: 'general' | 'after_order';
  /** ISO time; rules are ordered oldest first before the cap is applied. */
  createdAt?: string;
}

export const MAX_SITUATIONS = 20;
const MAX_CHARS = 20_000;

const GENERAL_HEADER = '## General rules';
const AFTER_ORDER_HEADER =
  '## After an order (apply these only right after an order or booking was just completed or confirmed, for example when an action call succeeded)';

const render = (item: SituationItem): string =>
  [item.title, item.trigger ? `Khi: ${item.trigger}` : '', item.content].filter(Boolean).join('\n');

const byCreation = (a: SituationItem, b: SituationItem): number =>
  (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

function build(general: string[], afterOrder: string[]): string {
  return [
    general.length ? [GENERAL_HEADER, ...general].join('\n\n') : '',
    afterOrder.length ? [AFTER_ORDER_HEADER, ...afterOrder].join('\n\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

/**
 * The text inside `<shop_situations>`: only enabled rules (a disabled rule never reaches the
 * model), the oldest {@link MAX_SITUATIONS} by creation time (stable for equal or missing
 * times), grouped under a header per section. A section with no rule has no header; no rule at
 * all gives an empty string.
 *
 * When the text would exceed {@link MAX_CHARS}, each rule is cut to a common length (short rules
 * keep everything, so long ones lose the most). The headers are never cut, so a section with
 * rules always keeps its header and its rules.
 */
export function situationsText(items: readonly SituationItem[]): string {
  const active = items
    .filter((item) => item.enabled !== false)
    .sort(byCreation) // Array.prototype.sort is stable
    .slice(0, MAX_SITUATIONS);
  const general = active.filter((item) => item.section !== 'after_order').map(render);
  const afterOrder = active.filter((item) => item.section === 'after_order').map(render);
  const full = build(general, afterOrder);
  if (full.length <= MAX_CHARS) return full;
  let low = 1;
  let high = Math.max(...general.concat(afterOrder).map((r) => r.length));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const fits =
      build(
        general.map((r) => cut(r, mid)),
        afterOrder.map((r) => cut(r, mid)),
      ).length <= MAX_CHARS;
    if (fits) low = mid;
    else high = mid - 1;
  }
  return build(
    general.map((r) => cut(r, low)),
    afterOrder.map((r) => cut(r, low)),
  );
}
