import { ArgumentsHost, Catch, HttpStatus, Injectable, RpcExceptionFilter } from '@nestjs/common';
import { type RmqContext } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

import { type AppLogger } from '../../logger/app-logger.js';
import { LoggerService } from '../../logger/logger.service.js';
import { ErrorFormatService } from '../error-format.service.js';

export const RPC_UNHANDLED_ERROR_LOG = 'unhandled exception in microservice handler';
export const RPC_REQUEST_REJECTED_LOG = 'microservice message rejected';

@Catch()
@Injectable()
export class RpcAppExceptionFilter implements RpcExceptionFilter<unknown, Observable<never>> {
  public constructor(
    private readonly errorFormatService: ErrorFormatService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(RpcAppExceptionFilter.name, 'rmq');
  }

  public catch(exception: unknown, host: ArgumentsHost): Observable<never> {
    const { statusCode, error } = this.errorFormatService.format(exception);
    const pattern = this.resolvePattern(host);
    const fields = { pattern, statusCode, errorCode: error.code };

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(fields, RPC_UNHANDLED_ERROR_LOG, exception);
    } else {
      this.logger.warn(fields, RPC_REQUEST_REJECTED_LOG);
    }

    return throwError(() => ({ statusCode, ...error }));
  }

  private readonly logger: AppLogger;

  private resolvePattern(host: ArgumentsHost): string {
    try {
      return host.switchToRpc().getContext<RmqContext>().getPattern();
    } catch {
      return 'unknown';
    }
  }
}
