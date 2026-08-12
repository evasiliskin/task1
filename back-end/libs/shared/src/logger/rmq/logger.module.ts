import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import pino from 'pino';

import loggerConfig from '../../config/logger.config.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { RequestContextModule } from '../../request-context/rmq/request-context.module.js';

import { LoggerService } from './logger.service.js';
import { pinoConfigFactory } from './pino-config.factory.js';
import { PINO_LOGGER } from './pino-instance.token.js';

@Module({
  imports: [RequestContextModule],
  providers: [
    {
      provide: PINO_LOGGER,
      inject: [loggerConfig.KEY, RequestContextService],
      useFactory: (
        config: ConfigType<typeof loggerConfig>,
        requestContextService: RequestContextService,
      ) => pino(pinoConfigFactory(config, requestContextService)),
    },
    LoggerService,
  ],
  exports: [LoggerService],
})
export class LoggerModule {}
