/** One owner instruction as the model sees it (a subset of the knowledge module's training item). */
export interface SituationItem {
  title: string;
  trigger?: string | null;
  content: string;
  /** Missing on items from before migration 0016: treated as enabled. */
  enabled?: boolean;
  /** Missing on items from before migration 0016: treated as `general`. */
  section?: 'general' | 'after_order';
}

export const MAX_SITUATIONS = 20;
const MAX_CHARS = 20_000;

const GENERAL_HEADER = '## General rules';
const AFTER_ORDER_HEADER =
  '## After an order (apply these only right after an order or booking was just completed or confirmed, for example when an action call succeeded)';

const render = (item: SituationItem): string =>
  [item.title, item.trigger ? `Khi: ${item.trigger}` : '', item.content].filter(Boolean).join('\n');

/**
 * The text inside `<shop_situations>`: only enabled rules (a disabled rule never reaches the
 * model), at most {@link MAX_SITUATIONS}, grouped under a header per section. A section with no
 * rule has no header; no rule at all gives an empty string.
 */
export function situationsText(items: readonly SituationItem[]): string {
  const active = items.filter((item) => item.enabled !== false).slice(0, MAX_SITUATIONS);
  const general = active.filter((item) => item.section !== 'after_order');
  const afterOrder = active.filter((item) => item.section === 'after_order');
  return [
    general.length ? [GENERAL_HEADER, ...general.map(render)].join('\n\n') : '',
    afterOrder.length ? [AFTER_ORDER_HEADER, ...afterOrder.map(render)].join('\n\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_CHARS);
}
