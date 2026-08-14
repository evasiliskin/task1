import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { FatalError } from '../errors/index.js';

import { CentralizedErrorHandlerService } from './centralized-error-handler.service.js';

/**
 * Registers process-level error handlers per nodejsbestpractices:
 * unhandledRejection is rethrown to become an uncaughtException, which is
 * the single place fatal errors are logged and the process is terminated.
 */
@Injectable()
export class ProcessErrorHandlerService implements OnModuleInit, OnModuleDestroy {
  public constructor(private readonly centralizedErrorHandler: CentralizedErrorHandlerService) {}

  public onModuleInit(): void {
    this.registerUnhandledRejection();
    this.registerUncaughtException();
  }

  public onModuleDestroy(): void {
    process.off('unhandledRejection', this.unhandledRejectionHandler);
    process.off('uncaughtException', this.uncaughtExceptionHandler);
  }

  private readonly unhandledRejectionHandler = (reason: unknown): void => {
    throw reason;
  };

  private readonly uncaughtExceptionHandler = (error: unknown): void => {
    this.centralizedErrorHandler.handleError(new FatalError(error));
  };

  private registerUnhandledRejection(): void {
    process.on('unhandledRejection', this.unhandledRejectionHandler);
  }

  private registerUncaughtException(): void {
    process.on('uncaughtException', this.uncaughtExceptionHandler);
  }
}
