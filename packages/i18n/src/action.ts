import en from './messages/en/action.json' with { type: 'json' };
import vi from './messages/vi/action.json' with { type: 'json' };

/**
 * The `action` namespace (custom bot actions and their results in the bot test chat) in every
 * locale. Kept out of `./vi` so it stays out of the initial bundle (docs/16 §1): the web app
 * loads it when a bot's space opens.
 */
export const action = { vi, en } as const;
