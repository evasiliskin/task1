export interface IQueueTopology {
  main: string;
  retry: string;
  deadLetter: string;
}

export function deriveQueueTopology(mainQueue: string): IQueueTopology {
  return {
    main: mainQueue,
    retry: `${mainQueue}.retry`,
    deadLetter: `${mainQueue}.dlq`,
  };
}

/**
 * No `x-message-ttl`: the delay is set per message via `expiration` so each retry attempt can back
 * off further. A queue-level TTL would force every attempt to wait the same fixed interval.
 *
 * Trade-off: RabbitMQ only expires messages from the head of a queue, so a longer-expiry message
 * sitting at the head blocks shorter-expiry messages behind it from expiring on time. Under a
 * burst of mixed-attempt failures, actual retry delays can exceed the computed ones. This is a
 * known, accepted trade-off of per-message `expiration`, not an oversight.
 */
export function buildRetryQueueArguments(mainQueue: string): Record<string, unknown> {
  return {
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': mainQueue,
  };
}
