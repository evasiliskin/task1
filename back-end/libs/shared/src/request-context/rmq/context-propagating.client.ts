import { Injectable } from '@nestjs/common';
import { type ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { type Observable } from 'rxjs';

import { buildOutboundHeaders } from '../propagation.util.js';
import { RequestContextService } from '../request-context.service.js';

@Injectable()
export class ContextPropagatingClient {
  public constructor(private readonly requestContextService: RequestContextService) {}

  public emit<T>(client: ClientProxy, pattern: string, data: unknown): Observable<T> {
    return client.emit<T>(pattern, this.wrap(data));
  }

  public send<T>(client: ClientProxy, pattern: string, data: unknown): Observable<T> {
    return client.send<T>(pattern, this.wrap(data));
  }

  private wrap(data: unknown): unknown {
    const headers = buildOutboundHeaders(this.requestContextService.requireContext());

    return new RmqRecordBuilder(data).setOptions({ headers }).build();
  }
}
