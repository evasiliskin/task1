import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { type IApiErrorResponse } from '../../api-response/api-response.types.js';
import { buildErrorEnvelope } from '../../api-response/error-envelope.utility.js';
import { type AppLogger } from '../../logger/app-logger.js';
import { LoggerService } from '../../logger/logger.service.js';
import { resolveId } from '../../request-context/id-validation.util.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { ErrorFormatService } from '../error-format.service.js';

export const UNHANDLED_ERROR_LOG = 'unhandled error';
export const REQUEST_REJECTED_LOG = 'request rejected';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  public constructor(
    private readonly errorFormatService: ErrorFormatService,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(GlobalExceptionFilter.name, 'http');
  }

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    // Requests that fail before RequestContextMiddleware runs (a body-parser error, for example)
    // have no context, so an id is minted here purely to keep the response envelope well formed.
    const attributes = this.requestContextService.getAttributes();
    const correlationId = attributes.correlationId ?? resolveId(undefined);
    const { statusCode, error } = this.errorFormatService.format(exception);

    // The correlation id is stamped by pino's mixin, so it is deliberately not interpolated into
    // the message — method, url and statusCode are fields, not prose, so they stay queryable.
    const fields = {
      method: request.method,
      url: request.originalUrl,
      statusCode,
      errorCode: error.code,
    };

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(fields, UNHANDLED_ERROR_LOG, exception);
    } else {
      // 4xx used to be invisible: the completion line showed a status code and nothing about the
      // cause, which made "why is this client getting 400s?" unanswerable from logs. Different
      // format strategies populate different cause-carrying fields (e.g. AppErrorFormatStrategy
      // sets `details`, RequestContractViolationFormatStrategy sets `fieldErrors`), so both are
      // logged here — JSON.stringify drops whichever one is undefined.
      this.logger.warn(
        { ...fields, details: error.details, fieldErrors: error.fieldErrors },
        REQUEST_REJECTED_LOG,
      );
    }

    const body: IApiErrorResponse = buildErrorEnvelope(statusCode, error, correlationId);

    response.status(statusCode).json(body);
  }

  private readonly logger: AppLogger;
}
