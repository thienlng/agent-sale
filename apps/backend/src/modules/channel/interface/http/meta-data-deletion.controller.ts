import type { MetaDataDeletionStatus } from '@agent-sales/contracts';
import { Controller, Get, Inject, Param } from '@nestjs/common';

import { Public } from '../../../../common/http/auth-context.js';
import {
  CHANNEL_DATA_DELETION_RUNNER,
  type ChannelDataDeletionRunner,
} from '../../api/channel-data-deletion.js';

/**
 * Public status of a Meta data deletion request: the link the callback answers Meta with
 * (docs/07 "Data deletion callback"). Codes are random 24-character strings; no personal data.
 */
@Controller('meta')
export class MetaDataDeletionController {
  constructor(
    @Inject(CHANNEL_DATA_DELETION_RUNNER) private readonly runner: ChannelDataDeletionRunner,
  ) {}

  @Public()
  @Get('data-deletion/:code')
  status(@Param('code') code: string): Promise<MetaDataDeletionStatus> {
    return this.runner.status(code);
  }
}
