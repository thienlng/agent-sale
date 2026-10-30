/**
 * Paths of the account layer (overview, create business), which work without a chosen
 * business. Kept apart from the sidebar component: the /app guard runs in the initial bundle.
 */
export const ACCOUNT_PATHS = /^\/app\/(overview|businesses)(\/|$)/;
