import { type ClientProxy } from '@nestjs/microservices';
import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { type ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';

export interface ISendRpcMessageOptions {
  propagatingClient: ContextPropagatingClient;
  client: ClientProxy;
  pattern: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}

function isDownstreamReply(error: unknown): boolean {
  return typeof error === 'object' && error !== null && !(error instanceof Error);
}

export async function sendRpcMessage<TReply>(options: ISendRpcMessageOptions): Promise<TReply> {
  try {
    return await firstValueFrom(
      options.propagatingClient
        .send<TReply>(options.client, options.pattern, options.payload)
        .pipe(timeout(options.timeoutMs)),
    );
  } catch (error) {
    if (error instanceof TimeoutError || isDownstreamReply(error)) {
      throw error;
    }

    throw new MessagePublishFailedError(options.pattern, error);
  }
}
