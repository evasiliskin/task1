export function buildRetryQueueArguments(
  mainQueue: string,
  delayMs: number,
): Record<string, unknown> {
  return {
    'x-message-ttl': delayMs,
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': mainQueue,
  };
}
