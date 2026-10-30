import { SaasLeadDetails, type SaasRequestKind } from '@agent-sales/contracts';
import { normalizeAnyPhone, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { BotSaasRequestResult } from '../api/saas.facade.js';
import { REQUESTED_STATUS, leadNote } from '../domain/saas-lead.js';
import { SaasError } from '../domain/saas.errors.js';

/** Signature of the notes the bot leaves on a customer. */
export const BOT_AUTHOR = 'Bot AI';

/**
 * A demo / trial / consultation request is not a record of its own: the customer is found or
 * created by phone, moved forward to "requested" and the details land in a note (ADR-014).
 */
@Injectable()
export class SaasLeadService {
  constructor(
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}

  /** The SaaS screens and tools exist only for SaaS businesses; others see 404. */
  async assertSaas(ws: WorkspaceId): Promise<void> {
    if ((await this.workspaces.getById(ws)).industry !== 'saas')
      throw new SaasError('NOT_FOUND', 'SaaS workspace not found');
  }

  async recordFromBot(
    ws: WorkspaceId,
    input: { kind: SaasRequestKind; details: unknown; preview: boolean },
  ): Promise<BotSaasRequestResult> {
    const parsed = SaasLeadDetails.safeParse(input.details);
    const phone = parsed.success ? normalizeAnyPhone(parsed.data.phone) : null;
    if (!parsed.success || !phone)
      return {
        outcome: 'invalid',
        problems: parsed.success
          ? ['phone: not a phone number']
          : parsed.error.issues.map((i) =>
              i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
            ),
      };
    if (input.preview) return { outcome: 'preview' };
    await this.assertSaas(ws);
    const lead = parsed.data;
    const { contactId, created } = await this.crm.upsertLeadByPhone(ws, {
      phoneE164: phone,
      sourceKey: 'bot',
      displayName: lead.name,
      firstUrl: null,
    });
    // Never moves a trial, paying or churned customer back to "requested".
    await this.crm.moveContactStatus(ws, contactId, REQUESTED_STATUS, { forwardOnly: true });
    await this.crm.addContactNote(ws, contactId, leadNote(input.kind, lead), BOT_AUTHOR);
    return { outcome: 'recorded', contactId, created };
  }
}
