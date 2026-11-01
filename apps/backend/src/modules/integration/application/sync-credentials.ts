import type { SecretBox } from '../../../common/security/secret-box.js';
import { KiotVietAuthError } from '../domain/integration.errors.js';
import type { ConnectionRecord } from './ports/integration-store.js';
import type { KvCredentials } from './ports/kiotviet-gateway.js';

/**
 * The connection's KiotViet credentials. A secret that no longer opens (key changed) counts as a
 * rejected secret: the owner gets the "update the code" path.
 */
export function openCredentials(secrets: SecretBox, c: ConnectionRecord): KvCredentials {
  let clientSecret: string;
  try {
    clientSecret = secrets.open(c.clientSecretSealed);
  } catch {
    throw new KiotVietAuthError();
  }
  return { retailer: c.retailer, clientId: c.clientId, clientSecret };
}
