import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ErrorFormatService } from './error-format.service';
import { ERROR_FORMAT_STRATEGIES } from './error-format.tokens';
import { GlobalExceptionFilter } from './global-exception.filter';
import { AppErrorFormatStrategy } from './strategies/app-error.format-strategy';
import { DefaultFormatStrategy } from './strategies/default.format-strategy';
import { HttpExceptionFormatStrategy } from './strategies/http-exception.format-strategy';
import { SerializedRpcErrorFormatStrategy } from './strategies/serialized-rpc-error.format-strategy';

@Module({
  providers: [
    SerializedRpcErrorFormatStrategy,
    AppErrorFormatStrategy,
    HttpExceptionFormatStrategy,
    DefaultFormatStrategy,
    {
      provide: ERROR_FORMAT_STRATEGIES,
      useFactory: (
        serializedRpc: SerializedRpcErrorFormatStrategy,
        appError: AppErrorFormatStrategy,
        httpException: HttpExceptionFormatStrategy,
        defaultStrategy: DefaultFormatStrategy,
      ) => [serializedRpc, appError, httpException, defaultStrategy],
      inject: [
        SerializedRpcErrorFormatStrategy,
        AppErrorFormatStrategy,
        HttpExceptionFormatStrategy,
        DefaultFormatStrategy,
      ],
    },
    ErrorFormatService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class ExceptionHandlingModule {}
