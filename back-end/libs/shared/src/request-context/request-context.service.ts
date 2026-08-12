import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import { MissingRequestContextError } from './missing-request-context.error.js';
import { type IRequestContext } from './request-context.types.js';

@Injectable()
export class RequestContextService {
  public run<T>(context: IRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  public getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  public getAttributes(): Partial<IRequestContext> {
    const store = this.storage.getStore();

    return store === undefined ? {} : { ...store };
  }

  public requireContext(): IRequestContext {
    const store = this.storage.getStore();

    if (store === undefined) {
      throw new MissingRequestContextError();
    }

    return store;
  }

  private readonly storage = new AsyncLocalStorage<IRequestContext>();
}
