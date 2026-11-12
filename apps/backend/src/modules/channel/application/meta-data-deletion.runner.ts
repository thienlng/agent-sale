import type { MetaDataDeletionStatus } from '@agent-sales/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import type { ChannelDataDeletionRunner } from '../api/channel-data-deletion.js';
import { ChannelError } from '../domain/channel.errors.js';
import { CHANNEL_STORE, type ChannelStore, type ConnectionRecord } from './ports/channel-store.js';
import { META_GATEWAY, type MetaGateway } from './ports/meta-gateway.js';

const log = new Logger('MetaDataDeletion');
const BATCH = 10;

/**
 * Meta data deletion requests (docs/07 "Data deletion callback"): `apps/webhook` verifies Meta's
 * signed request and stores it; this runner (worker, every minute) removes every page the
 * Facebook user connected, in whichever business: the webhook subscription is dropped while the
 * token still works, then the row becomes `removed` with its sealed token wiped, its bot unbound and
 * its grantor hash cleared, with a `channel.removed` audit event in that business. Businesses,
 * conversations and orders stay (they belong to the business, not to the person who logged in).
 * The request then completes and forgets the user hash. Idempotent: a retry finds nothing left.
 */
@Injectable()
export class MetaDataDeletionRunner implements ChannelDataDeletionRunner {
  constructor(
    @Inject(CHANNEL_STORE) private readonly store: ChannelStore,
    @Inject(META_GATEWAY) private readonly gateway: MetaGateway,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  async tick(): Promise<number> {
    const requests = await this.store.claimDataDeletions(BATCH);
    for (const request of requests) {
      try {
        const connections = await this.store.connectionsOfMetaUser(request.userHash);
        let removed = 0;
        for (const c of connections) if (await this.#remove(c, request.id)) removed += 1;
        await this.store.completeDataDeletion(request.id, removed);
        // Ids and counts only: neither the person nor a page name.
        log.log(`Data deletion request ${request.id} completed: ${removed} connections removed`);
      } catch (error) {
        // Claimed again next tick (up to 10 attempts).
        log.warn(`Data deletion request ${request.id} failed: ${(error as Error).name}`);
      }
    }
    return requests.length;
  }

  async status(confirmationCode: string): Promise<MetaDataDeletionStatus> {
    const r = /^[A-Za-z0-9]{16,64}$/.test(confirmationCode)
      ? await this.store.dataDeletion(confirmationCode)
      : null;
    if (!r) throw new ChannelError('NOT_FOUND', 'Data deletion request not found');
    return {
      confirmationCode: r.confirmationCode,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      connectionsRemoved: r.connectionsRemoved,
    };
  }

  async #remove(c: ConnectionRecord, requestId: string): Promise<boolean> {
    if (c.provider === 'facebook' || c.provider === 'instagram') {
      try {
        const token = this.box.open(c.tokenSealed);
        if (token) await this.gateway.unsubscribe(c.provider, { externalId: c.externalId, token });
      } catch {
        // Best effort, like a manual removal; the gateway logged Meta's code only.
        log.warn(`Webhook unsubscribe skipped for channel ${c.id}`);
      }
    }
    const removed = await this.store.remove(c.workspaceId, c.id, this.box.seal(''), {
      action: 'channel.removed',
      data: { reason: 'meta_data_deletion', provider: c.provider, requestId },
    });
    return removed !== null;
  }
}
