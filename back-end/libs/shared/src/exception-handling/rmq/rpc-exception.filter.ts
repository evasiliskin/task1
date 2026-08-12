import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  Injectable,
  Logger,
  RpcExceptionFilter,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';

import { ErrorFormatService } from '../error-format.service';

@Catch()
@Injectable()
export class RpcAppExceptionFilter implements RpcExceptionFilter<unknown, Observable<never>> {
  public constructor(private readonly errorFormatService: ErrorFormatService) {}

  public catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    const { statusCode, error } = this.errorFormatService.format(exception);

    if (statusCode >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        'Unhandled exception in microservice handler',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    return throwError(() => ({ statusCode, ...error }));
  }

  private readonly logger = new Logger(RpcAppExceptionFilter.name);
}
