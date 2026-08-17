import { Injectable } from '@nestjs/common';

import { ImportShuttingDownError } from './import-shutdown.error.js';

@Injectable()
export class InFlightImportRegistry {
  public async track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.shuttingDown) {
      throw new ImportShuttingDownError();
    }

    const running = operation();
    const settled = running.then(
      () => undefined,
      () => undefined,
    );

    this.operations.add(settled);

    try {
      return await running;
    } finally {
      this.operations.delete(settled);
    }
  }

  public beginShutdown(): void {
    this.shuttingDown = true;
  }

  public async drain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (this.operations.size > 0) {
      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        return false;
      }

      if (!(await this.awaitCurrentOperations(remainingMs))) {
        return false;
      }
    }

    return true;
  }

  public get size(): number {
    return this.operations.size;
  }

  public get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  private readonly operations = new Set<Promise<void>>();

  private shuttingDown = false;

  private async awaitCurrentOperations(timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });

    try {
      return await Promise.race([Promise.all([...this.operations]).then(() => true), timedOut]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
