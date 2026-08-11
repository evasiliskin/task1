import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ErrorFormatService } from './error-format.service';
import { IApiErrorResponse } from './error-response.types';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  public constructor(private readonly errorFormatService: ErrorFormatService) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const correlationId = this.resolveCorrelationId(request);
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
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.setHeader('x-correlation-id', correlationId);
    response.status(statusCode).json(body);
  }

  private readonly logger = new Logger(GlobalExceptionFilter.name);

  private resolveCorrelationId(request: Request): string {
    const header = request.headers['x-correlation-id'];

    if (typeof header === 'string' && header.length > 0) {
      return header;
    }
    return randomUUID();
  }
}
