import type { TFunction } from 'i18next';

/** Human label for a placeholder key such as `store.address`; unknown keys are shown as-is. */
export function placeholderLabel(t: TFunction, key: string): string {
  const i18nKey = `placeholders.${key.replaceAll('.', '__')}`;
  const label = t(i18nKey);
  return label === i18nKey ? key : label;
}
