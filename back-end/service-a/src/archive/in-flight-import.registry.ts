import { Injectable } from '@nestjs/common';

/**
 * Knows which imports are currently running.
 *
 * Shutdown closes MongoDB and Redis in `onApplicationShutdown`, which runs after Nest's
 * `onModuleDestroy` hooks. Without a drain, an import that has been streaming for minutes would
 * lose its connections mid-batch and leave its run document stuck in `started`. This is the
 * handle that lets shutdown wait instead.
 */
@Injectable()
export class InFlightImportRegistry {
  public async track<T>(operation: () => Promise<T>): Promise<T> {
    const running = operation();
    // Swallow here only so the set can be cleaned up; the original promise is what the caller
    // awaits, so the rejection still surfaces exactly once.
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

  /** Resolves `true` when everything finished, `false` if the timeout elapsed first. */
  public async drain(timeoutMs: number): Promise<boolean> {
    if (this.operations.size === 0) {
      return true;
    }

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

  public get size(): number {
    return this.operations.size;
  }

  private readonly operations = new Set<Promise<void>>();
}
