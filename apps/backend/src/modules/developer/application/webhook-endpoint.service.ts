import {
  type CreateWebhookEndpointRequest,
  type PublicEventType,
  type UpdateWebhookEndpointRequest,
  WEBHOOK_TEST_EVENT_TYPE,
  type WebhookDeliveryDto,
  type WebhookDeliveryPage,
  type WebhookDeliveryQuery,
  type WebhookEndpointDto,
  type WebhookEndpointWithSecret,
  type WebhookEnvelope,
} from '@agent-sales/contracts';
import { isUuid, newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  PublicApiLockedError,
  WebhookDeliveryNotFoundError,
  WebhookEndpointLimitError,
  WebhookEndpointNotFoundError,
  WebhookEndpointStaleError,
  WebhookUrlRejectedError,
} from '../domain/developer.errors.js';
import {
  type DeliveryRecord,
  DEVELOPER_STORE,
  type DeveloperStore,
  type EndpointRecord,
} from './ports/developer-store.js';
import {
  DEVELOPER_PLAN_GATE,
  type DeveloperPlanGate,
  WEBHOOK_TRANSPORT,
  type WebhookTransport,
} from './ports/webhook-transport.js';
import { newSigningSecret } from './webhook-signing.js';

/** Endpoints per workspace. */
export const MAX_ENDPOINTS = 20;
/** After a rotation the previous secret keeps signing this long (ADR-022 §5). */
export const ROTATION_OVERLAP_MS = 24 * 3_600_000;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toEndpointDto = (r: EndpointRecord): WebhookEndpointDto => ({
  id: r.id,
  url: r.url,
  description: r.description,
  events: r.events as PublicEventType[],
  enabled: r.enabled,
  disabledReason: r.disabledReason,
  failingSince: iso(r.failingSince),
  previousSecretExpiresAt: iso(r.previousSecretExpiresAt),
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const toDeliveryDto = (r: DeliveryRecord): WebhookDeliveryDto => ({
  id: r.id,
  endpointId: r.endpointId,
  eventId: r.eventId,
  eventType: r.eventType,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: iso(r.nextAttemptAt),
  lastStatusCode: r.lastStatusCode,
  lastError: r.lastError,
  deliveredAt: iso(r.deliveredAt),
  createdAt: r.createdAt.toISOString(),
  payload: r.payload,
});

/**
 * Settings → Developers, webhooks (ADR-022 §5–6): endpoint CRUD with the SSRF guard, signing
 * secrets sealed with SecretBox and shown once (on create and rotation), the test event, the
 * delivery log and resend. Callers check `developer.manage`.
 */
@Injectable()
export class WebhookEndpointService {
  constructor(
    @Inject(DEVELOPER_STORE) private readonly store: DeveloperStore,
    @Inject(WEBHOOK_TRANSPORT) private readonly transport: WebhookTransport,
    @Inject(DEVELOPER_PLAN_GATE) private readonly plan: DeveloperPlanGate,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  async list(ws: WorkspaceId): Promise<WebhookEndpointDto[]> {
    return (await this.store.listEndpoints(ws)).map(toEndpointDto);
  }

  async create(
    ws: WorkspaceId,
    actor: UserId,
    input: CreateWebhookEndpointRequest,
    now = new Date(),
  ): Promise<WebhookEndpointWithSecret> {
    if (!(await this.plan.enabled(ws))) throw new PublicApiLockedError();
    if ((await this.store.listEndpoints(ws)).length >= MAX_ENDPOINTS) {
      throw new WebhookEndpointLimitError(MAX_ENDPOINTS);
    }
    await this.#checkUrl(input.url);
    const secret = newSigningSecret();
    const r: EndpointRecord = {
      id: newId(),
      workspaceId: ws,
      url: input.url,
      description: input.description,
      events: [...new Set(input.events)],
      secretEncrypted: this.box.seal(secret),
      previousSecretEncrypted: null,
      previousSecretExpiresAt: null,
      enabled: true,
      disabledReason: null,
      failingSince: null,
      createdBy: actor,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insertEndpoint(r);
    return { endpoint: toEndpointDto(r), secret };
  }

  async update(
    ws: WorkspaceId,
    id: string,
    input: UpdateWebhookEndpointRequest,
    now = new Date(),
  ): Promise<WebhookEndpointDto> {
    const cur = await this.#endpoint(ws, id);
    if (cur.version !== input.version) throw new WebhookEndpointStaleError();
    if (input.url !== undefined && input.url !== cur.url) await this.#checkUrl(input.url);
    const next: EndpointRecord = {
      ...cur,
      url: input.url ?? cur.url,
      description: input.description ?? cur.description,
      events: input.events ? [...new Set(input.events)] : cur.events,
      version: cur.version + 1,
      updatedAt: now,
    };
    if (input.enabled === true && !cur.enabled) {
      // Re-enabling starts a fresh failure window.
      Object.assign(next, { enabled: true, disabledReason: null, failingSince: null });
    } else if (input.enabled === false && cur.enabled) {
      Object.assign(next, { enabled: false, disabledReason: 'manual' });
    }
    if (!(await this.store.saveEndpoint(next, cur.version))) throw new WebhookEndpointStaleError();
    return toEndpointDto(next);
  }

  async remove(ws: WorkspaceId, id: string): Promise<void> {
    if (!isUuid(id) || !(await this.store.deleteEndpoint(ws, id)))
      throw new WebhookEndpointNotFoundError();
  }

  /**
   * New signing secret; the current one becomes the previous and keeps signing (a second `v1`)
   * for 24 hours, so receivers can switch without dropping events.
   */
  async rotateSecret(
    ws: WorkspaceId,
    id: string,
    now = new Date(),
  ): Promise<WebhookEndpointWithSecret> {
    const cur = await this.#endpoint(ws, id);
    const secret = newSigningSecret();
    const next: EndpointRecord = {
      ...cur,
      secretEncrypted: this.box.seal(secret),
      previousSecretEncrypted: cur.secretEncrypted,
      previousSecretExpiresAt: new Date(now.getTime() + ROTATION_OVERLAP_MS),
      version: cur.version + 1,
      updatedAt: now,
    };
    if (!(await this.store.saveEndpoint(next, cur.version))) throw new WebhookEndpointStaleError();
    return { endpoint: toEndpointDto(next), secret };
  }

  /** Queues a `webhook.test` delivery, sent by the worker like any other event. */
  async sendTest(ws: WorkspaceId, id: string, now = new Date()): Promise<WebhookDeliveryDto> {
    const endpoint = await this.#endpoint(ws, id);
    const eventId = newId();
    const envelope: WebhookEnvelope = {
      id: eventId,
      type: WEBHOOK_TEST_EVENT_TYPE,
      workspaceId: ws,
      occurredAt: now.toISOString(),
      data: { message: 'This is a test event from Rapiz.' },
    };
    const r: DeliveryRecord = {
      id: newId(),
      workspaceId: ws,
      endpointId: endpoint.id,
      eventId,
      eventType: WEBHOOK_TEST_EVENT_TYPE,
      payload: envelope,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastStatusCode: null,
      lastError: null,
      deliveredAt: null,
      createdAt: now,
    };
    await this.store.insertDelivery(r);
    return toDeliveryDto(r);
  }

  async deliveries(
    ws: WorkspaceId,
    id: string,
    q: WebhookDeliveryQuery,
  ): Promise<WebhookDeliveryPage> {
    await this.#endpoint(ws, id);
    const page = await this.store.listDeliveries(ws, id, q);
    return { data: page.rows.map(toDeliveryDto), page: { nextCursor: page.nextCursor } };
  }

  /** Sends a delivery again with the same event id (receivers dedupe by it). */
  async resend(ws: WorkspaceId, deliveryId: string, now = new Date()): Promise<WebhookDeliveryDto> {
    const r = isUuid(deliveryId) ? await this.store.requeueDelivery(ws, deliveryId, now) : null;
    if (!r) throw new WebhookDeliveryNotFoundError();
    return toDeliveryDto(r);
  }

  async #endpoint(ws: WorkspaceId, id: string): Promise<EndpointRecord> {
    const r = isUuid(id) ? await this.store.getEndpoint(ws, id) : null;
    if (!r) throw new WebhookEndpointNotFoundError();
    return r;
  }

  async #checkUrl(url: string): Promise<void> {
    const reason = await this.transport.check(url);
    if (reason) throw new WebhookUrlRejectedError(reason);
  }
}
