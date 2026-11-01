import { Module } from '@nestjs/common';

import { INTEGRATION_FACADE } from './api/integration.facade.js';
import { IntegrationFacadeImpl } from './application/integration.facade.impl.js';
import { IntegrationController } from './interface/http/integration.controller.js';

/** Bind ports to adapters here. Export ONLY what api/ declares. */
@Module({
  controllers: [IntegrationController],
  providers: [{ provide: INTEGRATION_FACADE, useClass: IntegrationFacadeImpl }],
  exports: [INTEGRATION_FACADE],
})
export class IntegrationModule {}
