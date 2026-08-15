interface IThrottleState {
  lastLoggedAt: number;
  suppressedCount: number;
}

/**
 * One line per key per interval, carrying how many lines were suppressed in between.
 *
 * For conditions that repeat under fault at a rate nobody wants in the log: an ioredis reconnect
 * storm, a downstream that is down and being re-polled. The suppressed tally is what keeps this
 * honest — a throttle that silently drops lines misrepresents the severity of an outage.
 *
 * Deliberately owned by the call site rather than shared process-wide: the state is then scoped to
 * the thing being throttled, and two tests exercising the same condition cannot share a window.
 * The clock is injected so the behaviour is testable without fake timers.
 */
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

  /** Reads and clears the tally, so a suppressed run is reported exactly once. */
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
