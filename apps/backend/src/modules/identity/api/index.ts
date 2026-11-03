// Authentication is enforced by the global AuthGuard; other modules read the current
// user via @CurrentUser() (common/http/auth-context) and names via IDENTITY_FACADE.
export {
  IDENTITY_ADMIN_FACADE,
  IDENTITY_API_KEYS_FACADE,
  IDENTITY_DELEGATION_FACADE,
  IDENTITY_FACADE,
  type IdentityAdminFacade,
  type IdentityApiKeysFacade,
  type IdentityDelegationFacade,
  type IdentityFacade,
  type UserRef,
} from './identity.facade.js';
export * from './identity.events.js';
