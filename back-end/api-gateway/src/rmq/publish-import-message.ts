import { type ClientProxy } from '@nestjs/microservices';
import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { type ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { firstValueFrom } from 'rxjs';

export interface IPublishImportMessageOptions {
  propagatingClient: ContextPropagatingClient;
  client: ClientProxy;
  pattern: string;
  payload: Record<string, unknown>;
}

export async function publishImportMessage(options: IPublishImportMessageOptions): Promise<void> {
  try {
    await firstValueFrom(
      options.propagatingClient.emit(options.client, options.pattern, options.payload),
    );
  } catch (error) {
    throw new MessagePublishFailedError(options.pattern, error);
  }
}
