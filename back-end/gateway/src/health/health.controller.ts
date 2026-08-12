import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { type IAggregatedHealth, HealthCheckService } from './health-check.service';

const HEALTHY_EXAMPLE = {
  status: 'ok',
  services: {
    gateway: 'ok',
    rabbitmq: 'ok',
    serviceA: 'ok',
    serviceB: 'ok',
    mongodb: 'ok',
    redis: 'ok',
  },
};

const DEGRADED_EXAMPLE = {
  status: 'degraded',
  services: {
    gateway: 'ok',
    rabbitmq: 'ok',
    serviceA: 'ok',
    serviceB: 'unavailable',
    mongodb: 'ok',
    redis: 'ok',
  },
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(private readonly healthCheckService: HealthCheckService) {}

  @Get()
  @ApiOperation({ summary: 'Aggregated health of the gateway and all its dependencies' })
  @ApiOkResponse({
    description: 'Always returned; inspect `status` for overall health.',
    schema: { example: HEALTHY_EXAMPLE },
  })
  public async health(): Promise<IAggregatedHealth> {
    return await this.healthCheckService.getHealth();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — is the gateway process running' })
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'gateway' } } })
  public live(): { status: 'ok'; service: 'gateway' } {
    return this.healthCheckService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe — can the gateway currently serve requests',
    description:
      'Critical for readiness: rabbitmq, serviceA, serviceB. mongodb/redis are reported but never fail readiness.',
  })
  @ApiOkResponse({ schema: { example: HEALTHY_EXAMPLE } })
  @ApiServiceUnavailableResponse({ schema: { example: DEGRADED_EXAMPLE } })
  public async ready(@Res({ passthrough: true }) response: Response): Promise<IAggregatedHealth> {
    const { ready, result } = await this.healthCheckService.getReadiness();

    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }
}
