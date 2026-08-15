import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { MissingRequestContextError } from './missing-request-context.error.js';
import { type IRequestContext } from './request-context.types.js';

const EMPTY_ATTRIBUTES: Partial<IRequestContext> = Object.freeze({});

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

  /**
   * The live store, by reference, for pino's `mixin` — which runs for every written line and only
   * ever reads. `getAttributes()` keeps returning a copy for callers that might mutate.
   */
  public getStoreForLogging(): Partial<IRequestContext> {
    return this.storage.getStore() ?? EMPTY_ATTRIBUTES;
  }

  /**
   * Runs background work — timers, lifecycle hooks — under a fresh root context.
   *
   * Two things depend on this. Every line one sweep emits shares a correlation id, so the sweep is
   * followable; and `ContextPropagatingClient` can publish from background code without
   * `requireContext()` throwing, which it otherwise would at the publish call rather than at
   * startup.
   */
  public runAsRoot<T>(operation: string, callback: () => T): T {
    return this.run(
      {
        correlationId: randomUUID(),
        requestId: randomUUID(),
        correlationIdSource: 'generated',
        operation,
      },
      callback,
    );
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
