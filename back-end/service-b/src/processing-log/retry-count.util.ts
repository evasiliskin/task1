export const RETRY_COUNT_HEADER = 'x-retry-count';

export interface IRmqMessage {
  content: Buffer;
  properties: { headers?: Record<string, unknown> };
}

export function getRetryCount(message: IRmqMessage): number {
  // eslint-disable-next-line security/detect-object-injection -- RETRY_COUNT_HEADER is a fixed literal, not user input.
  const header = message.properties.headers?.[RETRY_COUNT_HEADER];
  const parsed = Number(header);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildRetryHeaders(
  message: IRmqMessage,
  retryCount: number,
): Record<string, unknown> {
  return { ...message.properties.headers, [RETRY_COUNT_HEADER]: retryCount };
}
