import { type ClientProxy } from '@nestjs/microservices';
import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { NEVER, of, throwError, TimeoutError } from 'rxjs';

import { sendRpcMessage } from './send-rpc-message.js';

describe('sendRpcMessage', () => {
  let requestContextService: RequestContextService;
  let propagatingClient: ContextPropagatingClient;

  beforeEach(() => {
    vi.clearAllMocks();

    requestContextService = new RequestContextService();
    propagatingClient = new ContextPropagatingClient(requestContextService);
  });

  const send = <T>(client: ClientProxy, timeoutMs = 50): Promise<T> =>
    requestContextService.run(
      {
        correlationId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      () =>
        sendRpcMessage<T>({
          propagatingClient,
          client,
          pattern: 'events.search',
          payload: { limit: 50 },
          timeoutMs,
        }),
    );

  it('should resolve to the reply, when the downstream service answers', async () => {
    const client = { send: vi.fn().mockReturnValue(of({ data: [] })) } as unknown as ClientProxy;

    await expect(send(client)).resolves.toEqual({ data: [] });
  });

  it('should reject with TimeoutError, when the downstream service does not answer in time', async () => {
    const client = { send: vi.fn().mockReturnValue(NEVER) } as unknown as ClientProxy;

    await expect(send(client)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('should reject with MessagePublishFailedError, when the transport fails', async () => {
    const client = {
      send: vi.fn().mockReturnValue(throwError(() => new Error('broker unavailable'))),
    } as unknown as ClientProxy;

    await expect(send(client)).rejects.toBeInstanceOf(MessagePublishFailedError);
  });

  it('should reject with the downstream reply untouched, when the consumer serializes an application error', async () => {
    const serialized = { statusCode: 404, code: 'IMPORT_NOT_FOUND', message: 'not found' };
    const client = {
      send: vi.fn().mockReturnValue(throwError(() => serialized)),
    } as unknown as ClientProxy;

    await expect(send(client)).rejects.toBe(serialized);
  });
});
