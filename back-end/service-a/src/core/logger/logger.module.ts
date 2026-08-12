import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import pino from 'pino';

import loggerConfig from '../../config/logger.config';
import { RequestContextModule } from '../request-context/request-context.module';
import { RequestContextService } from '../request-context/request-context.service';

import { LoggerService } from './logger.service';
import { pinoConfigFactory } from './pino-config.factory';
import { PINO_LOGGER } from './pino-instance.token';

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
