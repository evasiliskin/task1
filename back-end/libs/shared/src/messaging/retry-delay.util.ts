const JITTER_FRACTION = 0.2;
const MINIMUM_DELAY_MS = 1;

export function computeRetryDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  const jitterRange = exponential * JITTER_FRACTION;
  const jittered = exponential - jitterRange + random() * jitterRange * 2;

  return Math.max(MINIMUM_DELAY_MS, Math.min(Math.round(jittered), maxMs));
}
