import { Module } from '@nestjs/common';

import { LODGING_FACADE } from './api/lodging.facade.js';
import { LodgingFacadeImpl } from './application/lodging.facade.impl.js';
import { LodgingController } from './interface/http/lodging.controller.js';

/** Bind ports to adapters here. Export ONLY what api/ declares. */
@Module({
  controllers: [LodgingController],
  providers: [{ provide: LODGING_FACADE, useClass: LodgingFacadeImpl }],
  exports: [LODGING_FACADE],
})
export class LodgingModule {}
