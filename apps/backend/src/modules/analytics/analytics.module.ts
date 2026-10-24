import { Module } from '@nestjs/common';

import { ANALYTICS_FACADE } from './api/analytics.facade.js';
import { AnalyticsFacadeImpl } from './application/analytics.facade.impl.js';
import { AnalyticsController } from './interface/http/analytics.controller.js';

/** Bind ports to adapters here. Export ONLY what api/ declares. */
@Module({
  controllers: [AnalyticsController],
  providers: [{ provide: ANALYTICS_FACADE, useClass: AnalyticsFacadeImpl }],
  exports: [ANALYTICS_FACADE],
})
export class AnalyticsModule {}
