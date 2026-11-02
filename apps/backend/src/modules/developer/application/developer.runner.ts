import { Inject, Injectable } from '@nestjs/common';

import type { DeveloperRunner } from '../api/developer.runner.js';
import { WebhookDispatcher } from './webhook-dispatcher.js';
import { WebhookSender } from './webhook-sender.js';

/** One worker pass of webhooks: dispatch new public events, then send what is due. */
@Injectable()
export class WebhookRunner implements DeveloperRunner {
  constructor(
    @Inject(WebhookDispatcher) private readonly dispatcher: WebhookDispatcher,
    @Inject(WebhookSender) private readonly sender: WebhookSender,
  ) {}

  async tick(now = new Date()): Promise<number> {
    await this.dispatcher.dispatch(now);
    return this.sender.send(now);
  }
}
