import { Module } from '@nestjs/common';

import { getEnv } from '../../common/config.js';
import { INTEGRATION_FACADE } from './api/integration.facade.js';
import { IntegrationFacadeImpl } from './application/integration.facade.impl.js';
import { KIOTVIET_GATEWAY } from './application/ports/kiotviet-gateway.js';
import { KiotVietClient } from './infrastructure/clients/kiotviet-client.js';
import { IntegrationController } from './interface/http/integration.controller.js';

/** Bind ports to adapters here. Export ONLY what api/ declares. */
@Module({
  controllers: [IntegrationController],
  providers: [
    { provide: INTEGRATION_FACADE, useClass: IntegrationFacadeImpl },
    { provide: KIOTVIET_GATEWAY, useFactory: () => KiotVietClient.fromEnv(getEnv()) },
  ],
  exports: [INTEGRATION_FACADE],
})
export class IntegrationModule {}
