interface IThrottleState {
  lastLoggedAt: number;
  suppressedCount: number;
}

export class LogThrottle {
  public constructor(private readonly now: () => number = Date.now) {}

  public shouldLog(key: string, intervalMs: number): boolean {
    const state = this.states.get(key);
    const timestamp = this.now();

    if (state !== undefined && timestamp - state.lastLoggedAt < intervalMs) {
      state.suppressedCount += 1;

      return false;
    }

    this.states.set(key, {
      lastLoggedAt: timestamp,
      suppressedCount: state?.suppressedCount ?? 0,
    });

    return true;
  }

  public takeSuppressedCount(key: string): number {
    const state = this.states.get(key);

    if (state === undefined) {
      return 0;
    }

    const { suppressedCount } = state;

    state.suppressedCount = 0;

    return suppressedCount;
  }

  private readonly states = new Map<string, IThrottleState>();
}
