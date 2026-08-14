import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { ResponseEnvelopeModule } from '@task1/shared/exception-handling/http/response-envelope.module';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { type Redis } from 'ioredis';

import { AuthModule } from './auth/auth.module.js';
import appConfig from './config/app.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import reportConfig from './config/report.config.js';
import storageConfig from './config/storage.config.js';
import throttleConfig from './config/throttle.config.js';
import uploadConfig from './config/upload.config.js';
import { ContractModule } from './contract/contract.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthModule } from './health/health.module.js';
import { REDIS_CLIENT } from './health/infra-clients.tokens.js';
import { ImportsModule } from './imports/imports.module.js';
import { LogsModule } from './logs/logs.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RmqClientsModule } from './rmq/rmq-clients.module.js';
import { StatsModule } from './stats/stats.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [
        appConfig,
        loggerConfig,
        rabbitmqConfig,
        redisConfig,
        storageConfig,
        uploadConfig,
        reportConfig,
        throttleConfig,
      ],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    ResponseEnvelopeModule,
    HealthModule,
    RmqClientsModule,
    // ThrottlerModule must be imported (and its APP_GUARD provider registered)
    // before AuthModule: NestJS runs multiple global guards in registration
    // order, so rate limiting has to be evaluated before the (currently
    // allow-all) auth guard. `imports: [HealthModule]` here lets the factory
    // below inject the gateway's single shared REDIS_CLIENT instead of
    // opening a second Redis connection just for throttling.
    ThrottlerModule.forRootAsync({
      imports: [HealthModule],
      inject: [throttleConfig.KEY, REDIS_CLIENT],
      useFactory: (config: ConfigType<typeof throttleConfig>, redisClient: Redis) => ({
        throttlers: [{ ttl: config.ttlMs, limit: config.limit }],
        storage: new ThrottlerStorageRedisService(redisClient),
      }),
    }),
    AuthModule,
    ContractModule,
    ImportsModule,
    EventsModule,
    LogsModule,
    StatsModule,
    ReportsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
