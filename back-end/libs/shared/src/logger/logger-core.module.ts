import { type DynamicModule, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { pino } from 'pino';

import loggerConfig from '../config/logger.config.js';
import { RequestContextService } from '../request-context/request-context.service.js';

import { buildBasePinoOptions } from './base-pino-options.js';
import { LoggerFlushService } from './logger-flush.service.js';
import { LoggerService } from './logger.service.js';
import { LOG_CHANNEL, LOGGER_FACTORY, PINO_DESTINATION, PINO_LOGGER } from './logger.tokens.js';
import { createPinoDestination, type IFlushableDestination } from './pino-destination.factory.js';
import { type LogChannel } from './types.js';

/**
 * Owns the process-wide pino instance. The transport-specific modules
 * (`logger/http/logger.module.ts`, `logger/rmq/logger.module.ts`) import this and add only their
 * own request-logging middleware or interceptor.
 *
 * Consumers must import a transport module, not this one — `RequestContextService` has to come
 * from the matching (middleware- or interceptor-based) `RequestContextModule`.
 */
@Module({})
export class LoggerCoreModule {
  public static forChannel(channel: LogChannel): DynamicModule {
    return {
      module: LoggerCoreModule,
      providers: [
        { provide: LOG_CHANNEL, useValue: channel },
        {
          provide: PINO_DESTINATION,
          inject: [loggerConfig.KEY],
          useFactory: (config: ConfigType<typeof loggerConfig>) => createPinoDestination(config),
        },
        {
          provide: PINO_LOGGER,
          inject: [loggerConfig.KEY, RequestContextService, PINO_DESTINATION],
          useFactory: (
            config: ConfigType<typeof loggerConfig>,
            requestContextService: RequestContextService,
            destination: IFlushableDestination | undefined,
          ) => {
            const options = buildBasePinoOptions(config, requestContextService);

            return destination === undefined ? pino(options) : pino(options, destination);
          },
        },
        LoggerService,
        { provide: LOGGER_FACTORY, useExisting: LoggerService },
        LoggerFlushService,
      ],
      exports: [LoggerService, LOGGER_FACTORY, PINO_LOGGER, LOG_CHANNEL],
    };
  }
}
