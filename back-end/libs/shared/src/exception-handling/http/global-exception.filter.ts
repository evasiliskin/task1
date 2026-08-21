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

    const attributes = this.requestContextService.getAttributes();
    const correlationId = attributes.correlationId ?? resolveId(undefined);
    const { statusCode, error } = this.errorFormatService.format(exception);

    const fields = {
      method: request.method,
      url: request.originalUrl,
      statusCode,
      errorCode: error.code,
    };

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(fields, UNHANDLED_ERROR_LOG, exception);
    } else {
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
