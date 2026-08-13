import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import loggerConfig from '@task1/shared/config/logger.config';
import { ExceptionHandlingModule } from '@task1/shared/exception-handling/rmq/exception-handling.module';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { RequestContextModule } from '@task1/shared/request-context/rmq/request-context.module';

import mongodbConfig from './config/mongodb.config.js';
import rabbitmqConfig from './config/rabbitmq.config.js';
import redisConfig from './config/redis.config.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { ProcessingLogModule } from './processing-log/processing-log.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [loggerConfig, rabbitmqConfig, mongodbConfig, redisConfig],
    }),
    RequestContextModule,
    LoggerModule,
    ExceptionHandlingModule,
    MongoModule,
    RedisModule,
    HealthModule,
    ProcessingLogModule,
  ],
})
export class AppModule {}
