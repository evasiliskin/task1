import { LogThrottle } from './log-throttle.js';

const INTERVAL_MS = 30_000;

describe('LogThrottle', () => {
  it('should allow the first call and suppress the rest, when calls fall inside one window', () => {
    let now = 1000;
    const throttle = new LogThrottle(() => now);

    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(true);
    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(false);
    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(false);

    now = 31_000;

    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(true);
  });

  it('should report the suppressed count and reset the tally, when the window is drained', () => {
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

  it('should throttle each key independently, when different keys are used', () => {
    const throttle = new LogThrottle(() => 1000);

    expect(throttle.shouldLog('redis-error', INTERVAL_MS)).toBe(true);
    expect(throttle.shouldLog('mongo-error', INTERVAL_MS)).toBe(true);
  });

  it('should report zero suppressed, when the key has never been seen', () => {
    expect(new LogThrottle().takeSuppressedCount('never-used')).toBe(0);
  });
});
