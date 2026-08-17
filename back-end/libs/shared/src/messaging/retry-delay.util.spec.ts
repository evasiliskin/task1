import { computeRetryDelayMs } from './retry-delay.util.js';

describe('computeRetryDelayMs', () => {
  it('should double the base delay, when the attempt number increases', () => {
    const noJitter = () => 0.5;

    expect(computeRetryDelayMs(1, 1000, 600_000, noJitter)).toBe(1000);
    expect(computeRetryDelayMs(2, 1000, 600_000, noJitter)).toBe(2000);
    expect(computeRetryDelayMs(3, 1000, 600_000, noJitter)).toBe(4000);
  });

  it('should cap the delay at the configured maximum, when the computed delay exceeds it', () => {
    expect(computeRetryDelayMs(20, 1000, 60_000, () => 0.5)).toBe(60_000);
  });

  it('should apply jitter of plus or minus twenty percent, when a delay is computed', () => {
    expect(computeRetryDelayMs(1, 1000, 600_000, () => 0)).toBe(800);
    expect(computeRetryDelayMs(1, 1000, 600_000, () => 1)).toBe(1200);
  });

  it('should return at least one millisecond, when the computed delay rounds below it', () => {
    expect(computeRetryDelayMs(1, 1, 600_000, () => 0)).toBeGreaterThanOrEqual(1);
  });
});
