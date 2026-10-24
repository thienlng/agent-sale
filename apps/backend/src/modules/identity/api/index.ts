// Authentication is enforced by the global AuthGuard; other modules read the current
// user via @CurrentUser() (common/http/auth-context) and names via IDENTITY_FACADE.
export { IDENTITY_FACADE, type IdentityFacade } from './identity.facade.js';
export * from './identity.events.js';
