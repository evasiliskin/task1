import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { DependencyHealthService } from './dependency-health.service.js';
import { MongoHealthIndicator } from './mongo.health-indicator.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

@Module({
  imports: [TerminusModule],
  providers: [MongoHealthIndicator, RedisHealthIndicator, DependencyHealthService],
  exports: [MongoHealthIndicator, RedisHealthIndicator, DependencyHealthService, TerminusModule],
})
export class SharedHealthModule {}
