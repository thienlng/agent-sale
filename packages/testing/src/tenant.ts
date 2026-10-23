import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';

/** Two distinct tenants for cross-tenant tests (Rule 04: every endpoint has one). */
export function twoTenants(): { a: WorkspaceId; b: WorkspaceId } {
  return { a: workspaceId(newId()), b: workspaceId(newId()) };
}

/**
 * Asserts that reading tenant B's resource with tenant A's context fails as
 * NOT_FOUND (never FORBIDDEN, which would leak existence). `read` is whatever
 * call the test wants to make under tenant A.
 */
export async function expectCrossTenantNotFound(read: () => Promise<unknown>): Promise<void> {
  let outcome: 'ok' | 'not_found' | 'other' = 'ok';
  try {
    await read();
  } catch (e) {
    const code = (e as { code?: string; status?: number }) ?? {};
    outcome = code.code === 'NOT_FOUND' || code.status === 404 ? 'not_found' : 'other';
  }
  if (outcome !== 'not_found') {
    throw new Error(`cross-tenant read must fail with NOT_FOUND, got: ${outcome}`);
  }
}
