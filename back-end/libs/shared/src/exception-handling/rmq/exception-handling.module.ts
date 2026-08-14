import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { LoggerModule } from '../../logger/rmq/logger.module.js';
import { LoggerService } from '../../logger/rmq/logger.service.js';
import { CentralizedErrorHandlerService } from '../centralized-error-handler.service.js';
import { CENTRALIZED_ERROR_LOGGER } from '../centralized-error-handler.tokens.js';
import { ErrorFormatService } from '../error-format.service.js';
import { ERROR_FORMAT_STRATEGIES } from '../error-format.tokens.js';
import { ProcessErrorHandlerService } from '../process-error-handler.service.js';
import { AppErrorFormatStrategy } from '../strategies/app-error.format-strategy.js';
import { DefaultFormatStrategy } from '../strategies/default.format-strategy.js';
import { HttpExceptionFormatStrategy } from '../strategies/http-exception.format-strategy.js';

import { RpcAppExceptionFilter } from './rpc-exception.filter.js';

@Module({
  imports: [LoggerModule],
  providers: [
    AppErrorFormatStrategy,
    HttpExceptionFormatStrategy,
    DefaultFormatStrategy,
    {
      provide: ERROR_FORMAT_STRATEGIES,
      useFactory: (
        appError: AppErrorFormatStrategy,
        httpException: HttpExceptionFormatStrategy,
        defaultStrategy: DefaultFormatStrategy,
      ) => [appError, httpException, defaultStrategy],
      inject: [AppErrorFormatStrategy, HttpExceptionFormatStrategy, DefaultFormatStrategy],
    },
    ErrorFormatService,
    {
      provide: APP_FILTER,
      useClass: RpcAppExceptionFilter,
    },
    {
      provide: CENTRALIZED_ERROR_LOGGER,
      useFactory: (loggerService: LoggerService) =>
        loggerService.getLogger(CentralizedErrorHandlerService.name),
      inject: [LoggerService],
    },
    CentralizedErrorHandlerService,
    ProcessErrorHandlerService,
  ],
})
export class ExceptionHandlingModule {}
