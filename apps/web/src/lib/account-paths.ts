/**
 * Paths of the account layer (overview, create business), which work without a chosen
 * business. Kept apart from the sidebar component: the /app guard runs in the initial bundle.
 */
export const ACCOUNT_PATHS = /^\/app\/(overview|businesses)(\/|$)/;

/**
 * Pages shown with the account sidebar: the account layer plus the owner assistant, which works
 * for the whole account (ADR-024) but still needs a chosen business, so it is not in
 * `ACCOUNT_PATHS` (the guard sends a user without one to the overview).
 */
export const ACCOUNT_SIDEBAR_PATHS = /^\/app\/(overview|businesses|assistant)(\/|$)/;
