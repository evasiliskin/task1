import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ResponseEnvelopeModule } from '@task1/shared/api-response/response-envelope.module';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/http/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/http/request-context.module';
import { type Redis } from 'ioredis';

import { AuthModule } from './auth/auth.module.js';
import appConfig from './config/app.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import reportConfig from './config/report.config.js';
import storageConfig from './config/storage.config.js';
import swaggerConfig from './config/swagger.config.js';
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
        swaggerConfig,
        throttleConfig,
      ],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    ResponseEnvelopeModule,
    HealthModule,
    RmqClientsModule,
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
