import { type ClientProxy, type RmqRecordBuilder } from '@nestjs/microservices';
import { of } from 'rxjs';

import { RequestContextService } from '../request-context.service.js';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../request-context.types.js';

import { ContextPropagatingClient } from './context-propagating.client.js';

const CORRELATION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('ContextPropagatingClient', () => {
  let requestContextService: RequestContextService;
  let propagatingClient: ContextPropagatingClient;
  let client: { emit: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    requestContextService = new RequestContextService();
    propagatingClient = new ContextPropagatingClient(requestContextService);
    client = { emit: vi.fn(() => of(undefined)), send: vi.fn(() => of(undefined)) };
  });

  function runInContext<T>(callback: () => T): T {
    return requestContextService.run(
      {
        correlationId: CORRELATION_ID,
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      },
      callback,
    );
  }

  it('should attach the correlation header, when emitting', () => {
    runInContext(() => {
      propagatingClient.emit(client as unknown as ClientProxy, 'pattern', {
        importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      });
    });

    const [pattern, record] = client.emit.mock.calls[0] as [string, RmqRecordBuilder<unknown>];
    const { data, options } = record as unknown as {
      data: unknown;
      options: { headers: Record<string, string> };
    };

    expect(pattern).toBe('pattern');
    expect(data).toEqual({ importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' });
    // eslint-disable-next-line security/detect-object-injection
    expect(options.headers[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);
  });

  it('should mint a fresh request id per hop, when emitting', () => {
    runInContext(() => {
      propagatingClient.emit(client as unknown as ClientProxy, 'pattern', {});
    });

    const [, record] = client.emit.mock.calls[0] as [string, unknown];
    const { options } = record as { options: { headers: Record<string, string> } };

    // eslint-disable-next-line security/detect-object-injection
    expect(options.headers[REQUEST_ID_HEADER]).not.toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7');
  });

  it('should attach the correlation header, when sending', () => {
    runInContext(() => {
      propagatingClient.send(client as unknown as ClientProxy, 'pattern', { q: 1 });
    });

    const [, record] = client.send.mock.calls[0] as [string, unknown];
    const { options } = record as { options: { headers: Record<string, string> } };

    // eslint-disable-next-line security/detect-object-injection
    expect(options.headers[CORRELATION_ID_HEADER]).toBe(CORRELATION_ID);
  });

  it('should throw MissingRequestContextError, when called outside a request context', () => {
    expect(() =>
      propagatingClient.emit(client as unknown as ClientProxy, 'pattern', {}),
    ).toThrowError('RequestContextService was accessed outside of an active request context');
  });
});
