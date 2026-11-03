import en from './messages/en/developer.json' with { type: 'json' };
import vi from './messages/vi/developer.json' with { type: 'json' };

/**
 * The `developer` namespace (Settings → Developers: API keys and webhooks) in every locale. Kept out
 * of `./vi`: only owners and admins open these pages, so the web app loads it when the page opens.
 */
export const developer = { vi, en } as const;
