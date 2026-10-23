// identity exposes no facade yet: authentication is enforced by its global AuthGuard and
// other modules read the current user via @CurrentUser() (common/http/auth-context).
export * from './identity.events.js';
