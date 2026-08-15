import { MissingRequestContextError } from './missing-request-context.error.js';
import { RequestContextService } from './request-context.service.js';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  describe('run', () => {
    it('should make the context available inside the callback via getCorrelationId/getRequestId', () => {
      const result = service.run(
        { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: 'inbound' },
        () => ({
          correlationId: service.getCorrelationId(),
          requestId: service.getRequestId(),
        }),
      );

      expect(result).toEqual({ correlationId: 'c-1', requestId: 'r-1' });
    });

    it('should isolate concurrent contexts from each other', async () => {
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
          { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: 'inbound' },
          10,
        ),
        readBackAfterDelay(
          { correlationId: 'c-2', requestId: 'r-2', correlationIdSource: 'inbound' },
          0,
        ),
      ]);

      expect(first).toEqual({
        correlationId: 'c-1',
        requestId: 'r-1',
        correlationIdSource: 'inbound',
      });
      expect(second).toEqual({
        correlationId: 'c-2',
        requestId: 'r-2',
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
        { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: 'inbound' },
        () => service.getAttributes(),
      );

      expect(result).toEqual({
        correlationId: 'c-1',
        requestId: 'r-1',
        correlationIdSource: 'inbound',
      });
    });
  });

  describe('requireContext', () => {
    it('should return the active context, when called inside one', () => {
      const result = service.run(
        { correlationId: 'c-1', requestId: 'r-1', correlationIdSource: 'inbound' },
        () => service.requireContext(),
      );

      expect(result).toEqual({
        correlationId: 'c-1',
        requestId: 'r-1',
        correlationIdSource: 'inbound',
      });
    });

    it('should throw MissingRequestContextError, when called outside of any context', () => {
      expect(() => service.requireContext()).toThrow(MissingRequestContextError);
    });
  });
});
