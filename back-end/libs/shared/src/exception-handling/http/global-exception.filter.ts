import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { resolveId } from '../../request-context/id-validation.util.js';
import { RequestContextService } from '../../request-context/request-context.service.js';
import { ErrorFormatService } from '../error-format.service.js';

import { type IApiErrorResponse } from './api-response.types.js';
import { buildErrorEnvelope } from './error-envelope.utility.js';

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

    // Requests outside the global prefix (e.g. a misconfigured health probe) never
    // reach RequestContextMiddleware, so context can legitimately be absent here.
    const attributes = this.requestContextService.getAttributes();
    const correlationId = attributes.correlationId ?? resolveId(undefined);
    const { statusCode, error } = this.errorFormatService.format(exception);

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `[${correlationId}] Unhandled error on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: IApiErrorResponse = buildErrorEnvelope(statusCode, error, correlationId);

    response.status(statusCode).json(body);
  }

  private readonly logger = new Logger(GlobalExceptionFilter.name);
}
