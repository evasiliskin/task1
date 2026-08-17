import { type ClientProxy } from '@nestjs/microservices';
import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { type ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';

export interface IPublishImportMessageOptions {
  propagatingClient: ContextPropagatingClient;
  client: ClientProxy;
  pattern: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}

export async function publishImportMessage(options: IPublishImportMessageOptions): Promise<void> {
  try {
    await firstValueFrom(
      options.propagatingClient
        .emit(options.client, options.pattern, options.payload)
        .pipe(timeout(options.timeoutMs)),
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw error;
    }

    throw new MessagePublishFailedError(options.pattern, error);
  }
}
