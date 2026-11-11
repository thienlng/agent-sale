import {
  CARE_AFTER_SALE_DAYS,
  CARE_MESSAGES_DAILY,
  type CareSettingsResponse,
  type CareTemplateDto,
  CareTemplateKey,
  UpdateCareTemplateRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BILLING_FACADE, type BillingFacade } from '../../billing/api/index.js';
import {
  DEFAULT_DAILY_CARE_MESSAGES,
  hcmDay,
  MAX_MESSAGES_PER_24H,
  QUIET_FROM_HOUR,
  QUIET_TO_HOUR,
} from '../domain/care.js';
import { CareTemplateNotFoundError } from '../domain/care.errors.js';
import { CARE_STORE, type CareStore } from '../domain/ports/care.store.js';

/** The templates as the business set them (defaults: every template on, no instruction). */
export type CareTemplates = Record<CareTemplateKey, CareTemplateDto>;

const DEFAULTS = (key: CareTemplateKey): CareTemplateDto => ({
  key,
  enabled: true,
  instruction: '',
  afterSaleDays: CARE_AFTER_SALE_DAYS.default,
});

/** A reserved message of the day: give it back with `release` when the call fails. */
export interface CareReservation {
  day: string;
}

/**
 * Care settings (spec §5): per template on/off + instruction (+ after-sales days), and the daily
 * message cap `care.messages.daily` (entitlement; a plan without the key gets 100, `null` =
 * unlimited), counted in `care_usage` before each model call, separately from the Brain's cap.
 */
@Injectable()
export class CareSettingsService {
  constructor(
    @Inject(CARE_STORE) private readonly store: CareStore,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
  ) {}

  async templates(ws: WorkspaceId): Promise<CareTemplates> {
    const rows = new Map((await this.store.templates(ws)).map((r) => [r.key, r]));
    const out = {} as CareTemplates;
    for (const key of CareTemplateKey.options) {
      const r = rows.get(key);
      const days = r?.params.afterSaleDays;
      out[key] = r
        ? {
            key,
            enabled: r.enabled,
            instruction: r.instruction,
            afterSaleDays:
              typeof days === 'number' &&
              days >= CARE_AFTER_SALE_DAYS.min &&
              days <= CARE_AFTER_SALE_DAYS.max
                ? days
                : CARE_AFTER_SALE_DAYS.default,
          }
        : DEFAULTS(key);
    }
    return out;
  }

  async putTemplate(
    ws: WorkspaceId,
    key: string,
    input: UpdateCareTemplateRequest,
    now = new Date(),
  ): Promise<CareTemplateDto> {
    const parsedKey = CareTemplateKey.safeParse(key);
    if (!parsedKey.success) throw new CareTemplateNotFoundError(key);
    const body = UpdateCareTemplateRequest.parse(input);
    const current = (await this.templates(ws))[parsedKey.data];
    const afterSaleDays = body.afterSaleDays ?? current.afterSaleDays;
    await this.store.putTemplate(
      ws,
      {
        key: parsedKey.data,
        enabled: body.enabled,
        instruction: body.instruction,
        params: parsedKey.data === 'after_sale' ? { afterSaleDays } : {},
      },
      now,
    );
    return {
      key: parsedKey.data,
      enabled: body.enabled,
      instruction: body.instruction,
      afterSaleDays,
    };
  }

  /** The plan's daily limit (read like the Brain's: a plan without the key gets the default). */
  async limit(ws: WorkspaceId): Promise<number | null> {
    const { limits } = await this.billing.entitlements(ws);
    return CARE_MESSAGES_DAILY in limits
      ? (limits[CARE_MESSAGES_DAILY] ?? null)
      : DEFAULT_DAILY_CARE_MESSAGES;
  }

  async reserve(ws: WorkspaceId, now: Date): Promise<CareReservation | null> {
    const day = hcmDay(now);
    return (await this.store.reserveUsage(ws, day, await this.limit(ws))) ? { day } : null;
  }

  release(ws: WorkspaceId, r: CareReservation): Promise<void> {
    return this.store.releaseUsage(ws, r.day);
  }

  async settings(ws: WorkspaceId, now = new Date()): Promise<CareSettingsResponse> {
    const day = hcmDay(now);
    const [templates, used, limit] = await Promise.all([
      this.templates(ws),
      this.store.usedOn(ws, day),
      this.limit(ws),
    ]);
    return {
      templates: CareTemplateKey.options.map((k) => templates[k]),
      quietHours: { from: QUIET_FROM_HOUR, to: QUIET_TO_HOUR, timeZone: 'Asia/Ho_Chi_Minh' },
      maxPerConversationPerDay: MAX_MESSAGES_PER_24H,
      usage: { day, used, limit },
    };
  }
}
