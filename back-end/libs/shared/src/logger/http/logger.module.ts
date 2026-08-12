import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import loggerConfig from '../../config/logger.config';
import { RequestContextModule } from '../../request-context/http/request-context.module';
import { RequestContextService } from '../../request-context/request-context.service';

import { LoggerService } from './logger.service';
import { pinoConfigFactory } from './pino-config.factory';

@Module({
  imports: [
    RequestContextModule,
    PinoLoggerModule.forRootAsync({
      inject: [loggerConfig.KEY, RequestContextService],
      useFactory: (
        config: ConfigType<typeof loggerConfig>,
        requestContextService: RequestContextService,
      ) => pinoConfigFactory(config, requestContextService),
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
