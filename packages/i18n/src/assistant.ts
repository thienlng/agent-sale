import en from './messages/en/assistant.json' with { type: 'json' };
import vi from './messages/vi/assistant.json' with { type: 'json' };

/**
 * The `assistant` namespace (owner assistant panel, ADR-024) in every locale. Kept out of `./vi`
 * so it stays out of the initial bundle (docs/16 §1): the web app loads it with the lazy panel.
 */
export const assistant = { vi, en } as const;
