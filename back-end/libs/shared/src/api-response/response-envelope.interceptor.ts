import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import { resolveId } from '../request-context/id-validation.util.js';
import { RequestContextService } from '../request-context/request-context.service.js';

import { buildSuccessEnvelope } from './success-envelope.utility.js';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();

    return next.handle().pipe(
      map((payload: unknown) => {
        if (payload instanceof StreamableFile) {
          return payload;
        }

        const statusCode = response.statusCode ?? Number(HttpStatus.OK);
        const correlationId = this.requestContextService.getCorrelationId() ?? resolveId(undefined);

        return buildSuccessEnvelope(payload, correlationId, statusCode);
      }),
    );
  }
}
