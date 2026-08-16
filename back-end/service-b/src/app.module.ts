import { Module } from '@nestjs/common';
import { type ConfigType, ConfigModule } from '@nestjs/config';
import healthConfig from '@task1/shared/config/health.config';
import loggerConfig from '@task1/shared/config/logger.config';
import redisConfig from '@task1/shared/config/redis.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { MessagingModule } from '@task1/shared/messaging/messaging.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import reportConfig from './config/report.config.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { ProcessingLogModule } from './processing-log/processing-log.module.js';
import { ReportsModule } from './reports/reports.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, healthConfig, rabbitmqConfig, mongodbConfig, redisConfig, reportConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    MessagingModule.forQueueAsync({
      inject: [rabbitmqConfig.KEY],
      useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
        mainQueue: config.queue,
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
    ProcessingLogModule,
    ReportsModule,
  ],
})
export class AppModule {}
