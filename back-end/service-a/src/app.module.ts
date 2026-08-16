import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { MessagingModule } from '@task1/shared/messaging/messaging.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import { ArchiveModule } from './archive/archive.module.js';
import archiveConfig from './config/archive.config.js';
import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import storageConfig from './config/storage.config.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { RedisModule } from './infra/redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [
        loggerConfig,
        rabbitmqConfig,
        mongodbConfig,
        redisConfig,
        storageConfig,
        archiveConfig,
      ],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    MessagingModule.forQueueAsync({
      inject: [rabbitmqConfig.KEY],
      useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
        mainQueue: config.importsQueue,
        rabbitmqUrl: config.url,
        policy: {
          maxRetries: config.maxRetries,
          retryDelayMs: config.retryDelayMs,
          maxRetryDelayMs: config.maxRetryDelayMs,
        },
      }),
    }),
    MongoModule,
    RedisModule,
    HealthModule,
    ArchiveModule,
  ],
})
export class AppModule {}
