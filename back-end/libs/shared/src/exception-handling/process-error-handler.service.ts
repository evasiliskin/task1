import { Injectable, type OnModuleInit } from '@nestjs/common';

import { CentralizedErrorHandlerService } from './centralized-error-handler.service';

/**
 * Registers process-level error handlers per nodejsbestpractices:
 * unhandledRejection is rethrown to become an uncaughtException, which is
 * the single place fatal errors are logged and the process is terminated.
 */
@Injectable()
export class ProcessErrorHandlerService implements OnModuleInit {
  public constructor(private readonly centralizedErrorHandler: CentralizedErrorHandlerService) {}

  public onModuleInit(): void {
    this.registerUnhandledRejection();
    this.registerUncaughtException();
  }

  private registerUnhandledRejection(): void {
    process.on('unhandledRejection', (reason: unknown) => {
      throw reason;
    });
  }

  private registerUncaughtException(): void {
    process.on('uncaughtException', (error: unknown) => {
      this.centralizedErrorHandler.handleFatalError(error);
    });
  }
}
