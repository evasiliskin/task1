import { MissingRequestContextError } from './missing-request-context.error.js';
import { RequestContextService } from './request-context.service.js';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  describe('run', () => {
    it('should expose the correlation id and request id, when read inside the callback', () => {
      const result = service.run(
        {
          correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => ({
          correlationId: service.getCorrelationId(),
          requestId: service.getRequestId(),
        }),
      );

      expect(result).toEqual({
        correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      });
    });

    it('should keep each context isolated, when two runs overlap', async () => {
      const readBackAfterDelay = async (
        context: { correlationId: string; requestId: string; correlationIdSource: 'inbound' },
        delayMs: number,
      ) =>
        await service.run(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          return service.getAttributes();
        });

      const [first, second] = await Promise.all([
        readBackAfterDelay(
          {
            correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
            requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
            correlationIdSource: 'inbound',
          },
          10,
        ),
        readBackAfterDelay(
          {
            correlationId: '2b6d8a17-4c39-4f52-b8e1-7d40a9c35f26',
            requestId: 'a3d81b60-9f27-4e85-b104-2c6f5d90e731',
            correlationIdSource: 'inbound',
          },
          0,
        ),
      ]);

      expect(first).toEqual({
        correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      });
      expect(second).toEqual({
        correlationId: '2b6d8a17-4c39-4f52-b8e1-7d40a9c35f26',
        requestId: 'a3d81b60-9f27-4e85-b104-2c6f5d90e731',
        correlationIdSource: 'inbound',
      });
    });
  });

  describe('getCorrelationId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getCorrelationId()).toBeUndefined();
    });
  });

  describe('getRequestId', () => {
    it('should return undefined, when called outside of any context', () => {
      expect(service.getRequestId()).toBeUndefined();
    });
  });

  describe('getAttributes', () => {
    it('should return an empty object, when called outside of any context', () => {
      expect(service.getAttributes()).toEqual({});
    });

    it('should return a copy of the active context, when called inside one', () => {
      const result = service.run(
        {
          correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => service.getAttributes(),
      );

      expect(result).toEqual({
        correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      });
    });
  });

  describe('getStoreForLogging', () => {
    it('should return the same empty reference every time, when called outside of any context', () => {
      const first = service.getStoreForLogging();
      const second = service.getStoreForLogging();

      expect(first).toEqual({});
      expect(first).toBe(second);
    });

    it('should return the live context by reference, when called inside one', () => {
      const result = service.run(
        {
          correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => ({ store: service.getStoreForLogging(), attributes: service.getAttributes() }),
      );

      expect(result.store).toEqual({
        correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      });
      expect(result.store).not.toBe(result.attributes);
    });
  });

  describe('runAsRoot', () => {
    it('should establish a fresh root context, when runInRootContext is used', () => {
      const captured = service.runAsRoot('report-sweep', () => service.requireContext());

      expect(captured).toMatchObject({
        correlationIdSource: 'generated',
        operation: 'report-sweep',
      });
      expect(captured.correlationId).toEqual(expect.any(String));
      expect(captured.requestId).not.toBe(captured.correlationId);
    });

    it('should give each run its own correlation id, when runInRootContext is called twice', () => {
      const first = service.runAsRoot('report-sweep', () => service.requireContext().correlationId);
      const second = service.runAsRoot(
        'report-sweep',
        () => service.requireContext().correlationId,
      );

      expect(first).not.toBe(second);
    });
  });

  describe('requireContext', () => {
    it('should return the active context, when called inside one', () => {
      const result = service.run(
        {
          correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
          requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          correlationIdSource: 'inbound',
        },
        () => service.requireContext(),
      );

      expect(result).toEqual({
        correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
        requestId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        correlationIdSource: 'inbound',
      });
    });

    it('should throw MissingRequestContextError, when called outside of any context', () => {
      expect(() => service.requireContext()).toThrow(MissingRequestContextError);
    });
  });
});
