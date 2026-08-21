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

export function buildRetryQueueArguments(mainQueue: string): Record<string, unknown> {
  return {
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': mainQueue,
  };
}
