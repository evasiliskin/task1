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

/**
 * Publishes and waits for the broker to accept.
 *
 * Fire-and-forget made `202 Accepted` a lie: a refused publish left the caller holding an importId
 * for work that was never queued, with only a log line to show for it. Awaiting turns the status
 * code back into a guarantee.
 */
export async function publishImportMessage(options: IPublishImportMessageOptions): Promise<void> {
  try {
    await firstValueFrom(
      options.propagatingClient.emit(options.client, options.pattern, options.payload),
    );
  } catch (error) {
    throw new MessagePublishFailedError(options.pattern, error);
  }
}
