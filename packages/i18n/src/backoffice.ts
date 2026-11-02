import en from './messages/en/backoffice.json' with { type: 'json' };
import vi from './messages/vi/backoffice.json' with { type: 'json' };

/**
 * The `backoffice` namespace (platform admin) in every locale. Kept out of `./vi`: only platform
 * operators open these pages, so the web app loads it when an admin page opens.
 */
export const backoffice = { vi, en } as const;
