import type { TrainingHistoryDto } from '@agent-sales/contracts';

export type HistoryTab = 'settings' | 'training';
export type HistoryOrder = 'newest' | 'oldest';

export interface HistoryFilter {
  tab: HistoryTab;
  /** Inclusive local dates, `YYYY-MM-DD`. */
  from: string;
  to: string;
  order: HistoryOrder;
}

/** Local calendar date of a timestamp as `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Default range: the first day of the current month up to today. */
export function defaultRange(now = new Date()): { from: string; to: string } {
  return { from: localDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDay(now) };
}

/** Settings changes on one tab, training data (materials, media, FAQs) on the other. */
export function filterHistory(
  entries: readonly TrainingHistoryDto[],
  filter: HistoryFilter,
): TrainingHistoryDto[] {
  return entries
    .filter((e) => (filter.tab === 'settings') === (e.kind === 'settings'))
    .filter((e) => {
      const day = localDay(new Date(e.createdAt));
      return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to);
    })
    .sort((a, b) => {
      const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      return filter.order === 'newest' ? -diff : diff;
    });
}

/** i18n key suffixes for the sentence "<actor> <verb> <section> <title>". */
export const ACTION_VERB = { created: 'add', updated: 'edit', deleted: 'delete' } as const;
export const SECTION_KEY = {
  settings: 'settings',
  scenario: 'scenario',
  quick_reply: 'quickReply',
  media: 'media',
  media_folder: 'mediaFolder',
  faq: 'faq',
} as const satisfies Record<TrainingHistoryDto['kind'], string>;

const LABELLED_FIELDS = new Set([
  'name',
  'isActive',
  'mission',
  'greeting',
  'selfPronoun',
  'customerPronoun',
  'useCustomerName',
  'autoResumeAfterManual',
  'humanTakeoverMinutes',
  'silenceOnExternalReply',
  'fallbackMessage',
  'handoffMessage',
  'creativity',
  'modelTier',
  'language',
  'themeColor',
  'replySchedule',
  'placeholders',
  'title',
  'content',
  'trigger',
  'notes',
  'mediaUrl',
  'folderId',
  'question',
  'answer',
]);

/** The i18n key of a field's human label, or null when the raw name has to do. */
export function fieldLabelKey(field: string): string | null {
  return LABELLED_FIELDS.has(field) ? `space.history.fields.${field}` : null;
}

const BOOLEAN_FIELDS = new Set([
  'isActive',
  'useCustomerName',
  'autoResumeAfterManual',
  'silenceOnExternalReply',
]);
/** Fields whose values are option ids, with the i18n key prefix of their labels. */
const OPTION_FIELDS: Record<string, string> = {
  modelTier: 'space.settings.modelOptions',
  language: 'space.settings.languageOptions',
  creativity: 'common:settings.creativityOptions',
};
const MAX_TEXT = 80;

export type ValueView =
  | { type: 'empty' }
  | { type: 'onOff'; on: boolean }
  | { type: 'color'; value: string }
  | { type: 'option'; key: string }
  | { type: 'schedule'; mode: 'always' | 'custom'; start: string; end: string }
  | { type: 'text'; text: string };

export function truncate(text: string, max = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function isSchedule(v: unknown): v is { mode: 'always' | 'custom'; start: string; end: string } {
  return typeof v === 'object' && v !== null && 'mode' in v && 'start' in v && 'end' in v;
}

/** How a stored before/after value is shown in the change list. */
export function describeValue(field: string, value: unknown): ValueView {
  if (value === null || value === undefined || value === '') return { type: 'empty' };
  if (BOOLEAN_FIELDS.has(field) && typeof value === 'boolean') return { type: 'onOff', on: value };
  if (field === 'themeColor' && typeof value === 'string') return { type: 'color', value };
  const prefix = OPTION_FIELDS[field];
  if (prefix && typeof value === 'string') return { type: 'option', key: `${prefix}.${value}` };
  if (field === 'replySchedule' && isSchedule(value)) return { type: 'schedule', ...value };
  if (typeof value === 'object') {
    const text = Array.isArray(value)
      ? value.map(String).join(', ')
      : Object.entries(value)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(', ');
    return text ? { type: 'text', text: truncate(text) } : { type: 'empty' };
  }
  return { type: 'text', text: truncate(String(value)) };
}
