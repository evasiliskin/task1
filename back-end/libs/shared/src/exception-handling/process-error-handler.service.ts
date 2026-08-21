import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { FatalError } from '../errors/index.js';
import { RequestContextService } from '../request-context/request-context.service.js';
import { type IRequestContext } from '../request-context/request-context.types.js';

import { CentralizedErrorHandlerService } from './centralized-error-handler.service.js';

export const RAISING_REQUEST_CONTEXT = Symbol('RAISING_REQUEST_CONTEXT');

interface IContextCarrier {
  [RAISING_REQUEST_CONTEXT]?: Partial<IRequestContext>;
}

@Injectable()
export class ProcessErrorHandlerService implements OnModuleInit, OnModuleDestroy {
  public constructor(
    private readonly centralizedErrorHandler: CentralizedErrorHandlerService,
    private readonly requestContextService: RequestContextService,
  ) {}

  public onModuleInit(): void {
    this.registerUnhandledRejection();
    this.registerUncaughtException();
  }

  public onModuleDestroy(): void {
    process.off('unhandledRejection', this.unhandledRejectionHandler);
    process.off('uncaughtException', this.uncaughtExceptionHandler);
  }

  private readonly unhandledRejectionHandler = (reason: unknown): void => {
    const error: Error & IContextCarrier =
      reason instanceof Error ? reason : new Error(String(reason));

    // eslint-disable-next-line security/detect-object-injection -- RAISING_REQUEST_CONTEXT is a module-local Symbol constant, not user-controlled input.
    error[RAISING_REQUEST_CONTEXT] = this.requestContextService.getAttributes();

    throw error;
  };

  private readonly uncaughtExceptionHandler = (error: unknown): void => {
    // eslint-disable-next-line security/detect-object-injection -- RAISING_REQUEST_CONTEXT is a module-local Symbol constant, not user-controlled input.
    const carried = (error as IContextCarrier | null)?.[RAISING_REQUEST_CONTEXT];

    this.centralizedErrorHandler.handleError(
      new FatalError(error),
      carried ?? this.requestContextService.getAttributes(),
    );
  };

  private registerUnhandledRejection(): void {
    process.on('unhandledRejection', this.unhandledRejectionHandler);
  }

  private registerUncaughtException(): void {
    process.on('uncaughtException', this.uncaughtExceptionHandler);
  }
}
