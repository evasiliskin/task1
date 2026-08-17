import { Injectable } from '@nestjs/common';

@Injectable()
export class InFlightImportRegistry {
  public async track<T>(operation: () => Promise<T>): Promise<T> {
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
