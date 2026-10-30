import { ApiClientError } from '@/lib/api-client';

/**
 * Message for a failed page selection. A CONFLICT means the page is live in another business
 * (one business per page, T-142): say so instead of blaming permissions. The other business is
 * not named, since the caller may not be a member of it.
 */
export function selectionErrorKey(
  error: unknown,
): 'integrations.pageInOtherBusiness' | 'connectionError' {
  return error instanceof ApiClientError && error.code === 'CONFLICT'
    ? 'integrations.pageInOtherBusiness'
    : 'connectionError';
}
