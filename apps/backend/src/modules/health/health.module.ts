import { Module } from '@nestjs/common';

import { HealthController } from './interface/http/health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
