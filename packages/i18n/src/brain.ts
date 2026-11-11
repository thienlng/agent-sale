import en from './messages/en/brain.json' with { type: 'json' };
import vi from './messages/vi/brain.json' with { type: 'json' };

/**
 * The `brain` namespace (the Today screen, tasks and the Business Brain settings) in every
 * locale. Kept out of `./vi` so it stays out of the initial bundle (docs/16 §1): the web app
 * loads it when Today, the inbox or the settings open. The sidebar label stays in `common`.
 */
export const brain = { vi, en } as const;
