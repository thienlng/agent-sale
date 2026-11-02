import type { AssistantPageContext, AssistantPageForm } from '@agent-sales/contracts';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * The page-side half of the owner assistant (ADR-023). It lives in `lib/` because every feature's
 * pages describe themselves here and features may not import `features/assistant`. It is tiny and
 * eager; the assistant panel itself stays a lazy chunk.
 */

/** What a page says about itself; the route, targets and forms are added at send time. */
export type AssistantPageInfo = Omit<AssistantPageContext, 'route' | 'targets' | 'forms'>;

const usePageInfo = create<{ info: AssistantPageInfo | null }>()(() => ({ info: null }));

/**
 * Pages call this to describe themselves to the owner assistant (title, entity ids, empty fields,
 * errors). The description is dropped when the page unmounts. Pass a stable or memoised object.
 */
export function useAssistantContext(ctx: AssistantPageInfo): void {
  const key = JSON.stringify(ctx);
  useEffect(() => {
    usePageInfo.setState({ info: JSON.parse(key) as AssistantPageInfo });
    return () => usePageInfo.setState({ info: null });
  }, [key]);
}

// ─── Forms the assistant may fill (`fill_form`) ───────────────────────────────

/** A fillable field: what the model sees, and `empty` read from the page's current values. */
export type AssistantFormField = AssistantPageForm['fields'][number];
export type AssistantFormValues = Record<string, string | number>;

export interface AssistantFormOptions {
  /** `data-assistant-target` of the form's submit button, spotlighted after a fill. */
  submitTarget?: string;
  /** False keeps the form out of the registry (e.g. an edit page, or a read-only form). */
  enabled?: boolean;
  /** The fill opens a dialog: the panel steps aside and nothing is spotlighted (T175-R5). */
  opensDialog?: boolean;
}

interface RegisteredForm {
  /** Read at send time, so `empty` reflects what the owner has typed so far. */
  fields: () => AssistantFormField[];
  fill: (values: AssistantFormValues) => void;
  submitTarget: string | undefined;
  opensDialog: boolean;
}

/**
 * Forms on screen by id, as a stack: the last registration of an id is the active one. A list
 * registers its add dialog's form while the dialog is closed; the open dialog registers the same
 * id on top, and closing it gives the list's registration back (T175-R4).
 */
const forms = new Map<string, RegisteredForm[]>();
const listeners = new Set<() => void>();

/** The active (last) registration of `formId`, if any. */
function activeForm(formId: string): RegisteredForm | undefined {
  return forms.get(formId)?.at(-1);
}
function changed(): void {
  for (const listener of listeners) listener();
}

/**
 * Registers an on-screen form the assistant may fill. `fields` is a getter called each time a
 * message is sent (compute `empty` from the current values there); `onFill` receives only the
 * known fields, coerced to each field's type, and must set them on the form without submitting
 * it. The form is unregistered when the component unmounts.
 */
export function useAssistantForm(
  formId: string,
  fields: () => AssistantFormField[],
  onFill: (values: AssistantFormValues) => void,
  options: AssistantFormOptions = {},
): void {
  // The registry calls the latest closures, so the page may pass inline functions.
  const latest = useRef({ fields, onFill });
  useEffect(() => {
    latest.current = { fields, onFill };
  });
  const { submitTarget, enabled = true, opensDialog = false } = options;
  useEffect(() => {
    if (!enabled) return;
    const entry: RegisteredForm = {
      fields: () => latest.current.fields(),
      fill: (values) => latest.current.onFill(values),
      submitTarget,
      opensDialog,
    };
    forms.set(formId, [...(forms.get(formId) ?? []), entry]);
    changed();
    return () => {
      const rest = (forms.get(formId) ?? []).filter((e) => e !== entry);
      if (rest.length) forms.set(formId, rest);
      else forms.delete(formId);
      changed();
    };
  }, [formId, submitTarget, enabled, opensDialog]);
}

/**
 * Reads a number the model sent as text, Vietnamese style. Dots followed by exactly three digits
 * are thousands separators ("150.000" is 150000); any other dot is the decimal point ("12.5").
 * A comma followed by one or two final digits is the decimal comma ("12,5"); other commas are
 * thousands separators. Units and spaces are ignored. NaN when nothing sensible is left.
 */
export function parseFormNumber(raw: string): number {
  let text = raw.replace(/[^\d.,-]/g, '');
  const negative = text.startsWith('-');
  text = text.replace(/-/g, '');
  if (/,\d{1,2}$/.test(text)) {
    const at = text.lastIndexOf(',');
    text = `${text.slice(0, at).replace(/[.,]/g, '')}.${text.slice(at + 1)}`;
  } else {
    text = text.replace(/,/g, '').replace(/\.(?=\d{3}(?!\d))/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  const n = Number(text);
  return negative ? -n : n;
}

/** Keeps the values of known fields, as numbers for `number` fields and strings otherwise. */
function coerce(fields: AssistantFormField[], values: AssistantFormValues): AssistantFormValues {
  const out: AssistantFormValues = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (raw === undefined) continue;
    if (field.type === 'number') {
      const n = typeof raw === 'number' ? raw : parseFormNumber(raw);
      if (Number.isFinite(n)) out[field.name] = n;
    } else if (field.type === 'select') {
      const value = String(raw);
      if (!field.options || field.options.includes(value)) out[field.name] = value;
    } else {
      out[field.name] = String(raw);
    }
  }
  return out;
}

export type FillResult =
  { ok: true; submitTarget: string | undefined; opensDialog: boolean } | { ok: false };

/** Fills the active registration of a form; `ok: false` when none is on screen. Never submits. */
export function fillAssistantForm(formId: string, values: AssistantFormValues): FillResult {
  const form = activeForm(formId);
  if (!form) return { ok: false };
  form.fill(coerce(form.fields(), values));
  return { ok: true, submitTarget: form.submitTarget, opensDialog: form.opensDialog };
}

/** Resolves true once `formId` is registered (e.g. after a navigate), false after `timeoutMs`. */
export function waitForAssistantForm(formId: string, timeoutMs: number): Promise<boolean> {
  if (forms.has(formId)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const listener = () => {
      if (!forms.has(formId)) return;
      done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    function done(found: boolean): void {
      clearTimeout(timer);
      listeners.delete(listener);
      resolve(found);
    }
    listeners.add(listener);
  });
}

// ─── Send time ────────────────────────────────────────────────────────────────

const MAX_TARGETS = 40;
const MAX_FORMS = 5;
const MAX_FIELDS = 30;

/** The page context sent with a message: the page's own description, route, targets and forms. */
export function collectPageContext(route: string): AssistantPageContext {
  const targets = [
    ...new Set(
      Array.from(document.querySelectorAll<HTMLElement>('[data-assistant-target]'))
        .map((el) => el.dataset['assistantTarget'] ?? '')
        .filter((id) => id && id.length <= 60),
    ),
  ].slice(0, MAX_TARGETS);
  const onScreen = [...forms.keys()].slice(0, MAX_FORMS).flatMap((id) => {
    const form = activeForm(id);
    return form ? [{ id, fields: form.fields().slice(0, MAX_FIELDS) }] : [];
  });
  const info = usePageInfo.getState().info;
  return {
    ...info,
    route: route.slice(0, 200),
    ...(targets.length ? { targets } : {}),
    ...(onScreen.length ? { forms: onScreen } : {}),
  };
}

// ─── Asking on the owner's behalf (the ask button) ────────────────────────────

/** Longest text a page may ask with; the composer allows more, a fixed sentence never needs it. */
const MAX_REQUEST = 500;

export interface AssistantRequest {
  id: string;
  text: string;
}

/**
 * One pending question a page asked on the owner's behalf. The bubble opens the panel when one
 * appears; the panel `take()`s it once and sends it, or puts it in the composer while a turn runs.
 */
export const useAssistantRequest = create<{
  request: AssistantRequest | null;
  take: () => AssistantRequest | null;
}>()((set, get) => ({
  request: null,
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request;
  },
}));

/** Asks the assistant on the owner's behalf (the ask button); the bubble takes it once. */
export function requestAssistant(text: string): void {
  const value = text.trim().slice(0, MAX_REQUEST);
  if (!value) return;
  useAssistantRequest.setState({ request: { id: crypto.randomUUID(), text: value } });
}
