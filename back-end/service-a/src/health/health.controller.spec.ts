import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';

import rabbitmqConfig from '../config/rabbitmq.config';
import { RequestContextService } from '../core/request-context/request-context.service';

import { HealthController } from './health.controller';
import { SERVICE_B_RMQ_CLIENT } from './rabbitmq-clients.tokens';
import { RabbitMqPingHealthIndicator } from './rabbitmq-ping.health-indicator';

describe('HealthController', () => {
  let controller: HealthController;
  let requestContextService: RequestContextService;
  let serviceBClient: { send: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    serviceBClient = { send: vi.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        RabbitMqPingHealthIndicator,
        RequestContextService,
        { provide: SERVICE_B_RMQ_CLIENT, useValue: serviceBClient },
        { provide: rabbitmqConfig.KEY, useValue: { pingTimeoutMs: 3000 } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
    requestContextService = moduleRef.get(RequestContextService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('check', () => {
    it('should return ok health check result, when service-b replies to health.check', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      const result = await requestContextService.run(
        { correlationId: 'c-1', requestId: 'r-1' },
        () => controller.check(),
      );

      expect(result).toEqual({
        status: 'ok',
        info: { 'service-b': { status: 'up' } },
        error: {},
        details: { 'service-b': { status: 'up' } },
      });
    });

    it('should reject, when service-b does not reply', async () => {
      serviceBClient.send.mockReturnValue(throwError(() => new Error('connection refused')));

      await expect(
        requestContextService.run({ correlationId: 'c-1', requestId: 'r-1' }, () =>
          controller.check(),
        ),
      ).rejects.toThrow();
    });

    it('should forward the active correlation id and a fresh request id to service-b', async () => {
      serviceBClient.send.mockReturnValue(of({ status: 'ok' }));

      await requestContextService.run({ correlationId: 'c-1', requestId: 'r-inbound' }, () =>
        controller.check(),
      );

      const [pattern, record] = serviceBClient.send.mock.calls[0] as [
        string,
        { options: { headers: Record<string, string> } },
      ];

      expect(pattern).toBe('health.check');
      expect(record.options.headers['x-correlation-id']).toBe('c-1');
      expect(record.options.headers['x-request-id']).not.toBe('r-inbound');
    });
  });
});
