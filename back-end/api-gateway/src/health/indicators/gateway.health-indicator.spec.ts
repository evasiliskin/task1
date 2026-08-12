import { type HealthIndicatorService } from '@nestjs/terminus';

import { GatewayHealthIndicator } from './gateway.health-indicator.js';

describe('GatewayHealthIndicator', () => {
  it('should report the indicator as up, when checked', () => {
    const upMock = vi.fn().mockReturnValue({ gateway: { status: 'up' } });
    const healthIndicatorService = {
      check: vi.fn().mockReturnValue({ up: upMock, down: vi.fn() }),
    } as unknown as HealthIndicatorService;

    const indicator = new GatewayHealthIndicator(healthIndicatorService);

    const result = indicator.isHealthy('gateway');

    expect(result).toEqual({ gateway: { status: 'up' } });
  });
});
