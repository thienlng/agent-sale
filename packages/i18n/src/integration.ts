import en from './messages/en/integration.json' with { type: 'json' };
import vi from './messages/vi/integration.json' with { type: 'json' };

/**
 * The `integration` namespace (PMS integrations) in every locale. Kept out of `./vi` so it stays
 * out of the initial bundle (docs/16 §1): the web app loads it when an integration page opens.
 */
export const integration = { vi, en } as const;
