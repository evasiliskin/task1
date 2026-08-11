import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { RequestContextService } from '../request-context/request-context.service';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../request-context/request-context.types';

import { ErrorFormatService } from './error-format.service';
import { IApiErrorResponse } from './error-response.types';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  public constructor(
    private readonly errorFormatService: ErrorFormatService,
    private readonly requestContextService: RequestContextService,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const { correlationId, requestId } = this.requestContextService.requireContext();
    const { statusCode, error } = this.errorFormatService.format(exception);

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `[${correlationId}] Unhandled error on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: IApiErrorResponse = {
      statusCode,
      error,
      correlationId,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(statusCode).json(body);
  }

  private readonly logger = new Logger(GlobalExceptionFilter.name);
}
