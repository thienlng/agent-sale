import en from './messages/en/notification.json' with { type: 'json' };
import vi from './messages/vi/notification.json' with { type: 'json' };

/**
 * The `notification` namespace (the bell, notification emails and the scheduled report texts,
 * T-172) in every locale. The backend renders notifications from it too (S3-R6), so the bell
 * and the email show the same words.
 */
export const notification = { vi, en } as const;

export type NotificationLocale = keyof typeof notification;

type Tree = { readonly [key: string]: string | Tree };

/** The catalog as flat `a.b.c` keys, for renderers that fill `{{var}}` placeholders. */
export function notificationStrings(locale: NotificationLocale): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: Tree, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') out[path] = value;
      else walk(value, path);
    }
  };
  walk(notification[locale] as Tree, '');
  return out;
}
