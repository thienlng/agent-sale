import { Inject, Injectable, Logger } from '@nestjs/common';

import type { WebchatRunner } from '../../api/webchat.runner.js';
import { WebchatService } from '../webchat.service.js';

const EVERY_MS = 60 * 60 * 1000;

/** Purges unreferenced visitor uploads once an hour (idempotent, so several workers are fine). */
@Injectable()
export class UploadPurgeRunner implements WebchatRunner {
  readonly #log = new Logger(UploadPurgeRunner.name);
  #lastRun = 0;

  constructor(@Inject(WebchatService) private readonly service: WebchatService) {}

  async tick(now: Date = new Date()): Promise<number> {
    if (now.getTime() - this.#lastRun < EVERY_MS) return 0;
    this.#lastRun = now.getTime();
    const deleted = await this.service.purgeTemporaryUploads(now);
    if (deleted > 0) this.#log.log(`purged ${deleted} unreferenced website-chat uploads`);
    return deleted;
  }
}
