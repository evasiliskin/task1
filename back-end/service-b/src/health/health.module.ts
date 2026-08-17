import { Module } from '@nestjs/common';
import { SharedHealthModule } from '@task1/shared/health/health.module';

import { HealthController } from './health.controller.js';

@Module({
  imports: [SharedHealthModule],
  controllers: [HealthController],
})
export class HealthModule {}
