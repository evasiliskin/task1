import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { MongoClient } from 'mongodb';

import mongodbConfig from '../../config/mongodb.config.js';
import { MONGO_CLIENT } from '../infra-clients.tokens.js';

import { MongoConnectionService } from './mongo-connection.service.js';

@Global()
@Module({
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
