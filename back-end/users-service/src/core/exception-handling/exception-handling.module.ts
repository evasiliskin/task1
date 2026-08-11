import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { ErrorFormatService } from './error-format.service';
import { ERROR_FORMAT_STRATEGIES } from './error-format.tokens';
import { RpcAppExceptionFilter } from './rpc-exception.filter';
import { AppErrorFormatStrategy } from './strategies/app-error.format-strategy';
import { DefaultFormatStrategy } from './strategies/default.format-strategy';
import { HttpExceptionFormatStrategy } from './strategies/http-exception.format-strategy';

@Module({
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
  ],
})
export class ExceptionHandlingModule {}
