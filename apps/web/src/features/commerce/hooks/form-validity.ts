import type { TFunction } from 'i18next';

type Validatable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isValidatable = (el: Element): el is Validatable =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLSelectElement ||
  el instanceof HTMLTextAreaElement;

/**
 * The form's invalid fields, in document order, judged by the browser's own constraints
 * (`required`, `pattern`, `type`). The form uses `noValidate`, so nothing else reports them.
 */
export function invalidFields(form: HTMLFormElement): Validatable[] {
  return Array.from(form.elements).filter(
    (el): el is Validatable => isValidatable(el) && el.willValidate && !el.validity.valid,
  );
}

/** A Vietnamese (localized) line for why a field is invalid, shown under it. */
export function validityMessage(t: TFunction, el: Validatable): string {
  if (el.validity.valueMissing) return t('errors.required');
  if (el.type === 'tel') return t('errors.invalidPhone');
  if (el.type === 'email') return t('errors.invalidEmail');
  return t('errors.invalidValue');
}

/**
 * Brings a field into view in the middle of the screen, clear of the order form's sticky total
 * bar (TM-8), and focuses it without a second jump.
 */
export function revealField(el: HTMLElement): void {
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}
