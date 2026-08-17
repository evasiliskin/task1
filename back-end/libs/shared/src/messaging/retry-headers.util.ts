import { type IRmqMessage } from './rmq-channel.types.js';

export const RETRY_COUNT_HEADER = 'x-retry-count';

export function getRetryCount(message: IRmqMessage): number {
  // eslint-disable-next-line security/detect-object-injection -- RETRY_COUNT_HEADER is a fixed literal, not user input.
  const header = message.properties.headers?.[RETRY_COUNT_HEADER];
  const parsed = Number(header);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function isRedelivered(message: IRmqMessage): boolean {
  return message.fields?.redelivered === true;
}

export function buildRetryHeaders(
  message: IRmqMessage,
  retryCount: number,
): Record<string, unknown> {
  return { ...message.properties.headers, [RETRY_COUNT_HEADER]: retryCount };
}
