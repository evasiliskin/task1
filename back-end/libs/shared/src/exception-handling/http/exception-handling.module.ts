import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { LoggerModule } from '../../logger/http/logger.module.js';
import { LoggerService } from '../../logger/http/logger.service.js';
import { CentralizedErrorHandlerService } from '../centralized-error-handler.service.js';
import { CENTRALIZED_ERROR_LOGGER } from '../centralized-error-handler.tokens.js';
import { ErrorFormatService } from '../error-format.service.js';
import { ERROR_FORMAT_STRATEGIES } from '../error-format.tokens.js';
import { ProcessErrorHandlerService } from '../process-error-handler.service.js';
import { AppErrorFormatStrategy } from '../strategies/app-error.format-strategy.js';
import { DefaultFormatStrategy } from '../strategies/default.format-strategy.js';
import { HttpExceptionFormatStrategy } from '../strategies/http-exception.format-strategy.js';
import { TimeoutErrorFormatStrategy } from '../strategies/timeout-error.format-strategy.js';

import { GlobalExceptionFilter } from './global-exception.filter.js';
import { SerializedRpcErrorFormatStrategy } from './serialized-rpc-error.format-strategy.js';

@Module({
  imports: [LoggerModule],
  providers: [
    SerializedRpcErrorFormatStrategy,
    AppErrorFormatStrategy,
    HttpExceptionFormatStrategy,
    TimeoutErrorFormatStrategy,
    DefaultFormatStrategy,
    {
      provide: ERROR_FORMAT_STRATEGIES,
      useFactory: (
        serializedRpc: SerializedRpcErrorFormatStrategy,
        appError: AppErrorFormatStrategy,
        httpException: HttpExceptionFormatStrategy,
        timeoutError: TimeoutErrorFormatStrategy,
        defaultStrategy: DefaultFormatStrategy,
      ) => [serializedRpc, appError, httpException, timeoutError, defaultStrategy],
      inject: [
        SerializedRpcErrorFormatStrategy,
        AppErrorFormatStrategy,
        HttpExceptionFormatStrategy,
        TimeoutErrorFormatStrategy,
        DefaultFormatStrategy,
      ],
    },
    ErrorFormatService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
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
