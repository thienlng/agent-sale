import en from './messages/en/security.json' with { type: 'json' };
import vi from './messages/vi/security.json' with { type: 'json' };

/**
 * The `security` namespace (the account security page: two-step verification, recovery codes,
 * linked sign-ins) in every locale. Kept out of `./vi` so it stays out of the initial bundle
 * (docs/16 §1): the web app loads it when the security settings open. Keys keep their
 * `wsettings.security.*` path; the page reads them with `useTranslation(['security', 'common'])`.
 */
export const security = { vi, en } as const;
