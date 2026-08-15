import { LogThrottle } from './log-throttle.js';

const INTERVAL_MS = 30_000;

describe('LogThrottle', () => {
  it('should allow the first call and suppress the rest of the window', () => {
    let now = 1000;
    const throttle = new LogThrottle(() => now);

    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(true);
    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(false);
    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(false);

    now = 31_000;

    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(true);
  });

  it('should report how many calls were suppressed, then reset the tally', () => {
    let now = 1000;
    const throttle = new LogThrottle(() => now);

    throttle.shouldLog('redis-error', INTERVAL_MS);
    throttle.shouldLog('redis-error', INTERVAL_MS);
    throttle.shouldLog('redis-error', INTERVAL_MS);

    now = 31_000;
    throttle.shouldLog('redis-error', INTERVAL_MS);

    expect(throttle.takeSuppressedCount('redis-error')).toBe(2);
    expect(throttle.takeSuppressedCount('redis-error')).toBe(0);
  });

  it('should track keys independently', () => {
    const throttle = new LogThrottle(() => 1000);

    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(true);
    expect(throttle.shouldLog('mongo-error', INTERVAL_MS)).toBe(true);
  });

  it('should report zero suppressed for a key it has never seen', () => {
    expect(new LogThrottle().takeSuppressedCount('never-used')).toBe(0);
  });
});
