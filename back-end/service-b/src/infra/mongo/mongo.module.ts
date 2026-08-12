import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { LoggerModule } from '@task1/shared/logger/rmq/logger.module';
import { MongoClient } from 'mongodb';

import mongodbConfig from '../../config/mongodb.config.js';
import { MONGO_CLIENT } from '../infra-clients.tokens.js';

import { MongoConnectionService } from './mongo-connection.service.js';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [
    MongoConnectionService,
    {
      provide: MONGO_CLIENT,
      inject: [mongodbConfig.KEY],
      useFactory: (config: ConfigType<typeof mongodbConfig>) => new MongoClient(config.uri),
    },
  ],
  exports: [MONGO_CLIENT],
})
export class MongoModule {}
