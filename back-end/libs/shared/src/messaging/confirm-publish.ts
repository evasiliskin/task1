import { randomUUID } from 'node:crypto';

import { MessagePublishFailedError } from '../errors/external/message-publish-failed.error.js';

import {
  type IRmqChannel,
  type IRmqPublishOptions,
  type IRmqReturnedMessage,
} from './rmq-channel.types.js';

export interface IConfirmPublishOptions {
  channel: IRmqChannel;
  queue: string;
  content: Buffer;
  headers: Record<string, unknown>;
  expiration?: string;
}

function buildPublishOptions(
  options: IConfirmPublishOptions,
  messageId: string,
): IRmqPublishOptions {
  return {
    headers: options.headers,
    ...(options.expiration === undefined ? {} : { expiration: options.expiration }),
    persistent: true,
    mandatory: true,
    messageId,
  };
}

export async function publishConfirmed(options: IConfirmPublishOptions): Promise<void> {
  const messageId = randomUUID();
  let rejectUnroutable: ((error: Error) => void) | undefined;

  const onReturn = (returned: IRmqReturnedMessage): void => {
    if (returned.properties.messageId === messageId) {
      rejectUnroutable?.(new MessagePublishFailedError(options.queue));
    }
  };

  options.channel.on('return', onReturn);

  try {
    await new Promise<void>((resolve, reject) => {
      rejectUnroutable = reject;

      options.channel.sendToQueue(
        options.queue,
        options.content,
        buildPublishOptions(options, messageId),
        (error: unknown) => {
          if (error === null || error === undefined) {
            resolve();

            return;
          }

          reject(new MessagePublishFailedError(options.queue, error));
        },
      );
    });
  } finally {
    options.channel.off('return', onReturn);
  }
}
