import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { Public } from '../auth/public.decorator.js';
import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { EmptyRequestSchema } from '../contract/schemas/empty.schema.js';

import { type IAggregatedHealth, HealthCheckService } from './health-check.service.js';
import { HealthResponseSchema, LivenessResponseSchema } from './schemas/health-response.schema.js';

const DEGRADED_EXAMPLE = {
  status: 'SUCCESS',
  code: 503,
  message: 'OK',
  result: {
    data: {
      status: 'degraded',
      services: {
        gateway: 'ok',
        rabbitmq: 'ok',
        serviceA: 'ok',
        serviceB: 'unavailable',
        redis: 'ok',
      },
    },
  },
  meta: { tracing: { correlationId: '2f1fdc5d-4324-4f56-95ae-d25df842bd7b' } },
};

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  public constructor(private readonly healthCheckService: HealthCheckService) {}

  @Public()
  @Get()
  @Contract({ request: EmptyRequestSchema, response: HealthResponseSchema })
  @ApiOperation({ summary: 'Aggregated health of the gateway and all its dependencies' })
  @ApiSingleResponse(HealthResponseSchema, {
    description: 'Always returned; inspect `status` for overall health.',
  })
  public async health(): Promise<IAggregatedHealth> {
    return await this.healthCheckService.getHealth();
  }

  @Public()
  @Get('live')
  @Contract({ request: EmptyRequestSchema, response: LivenessResponseSchema })
  @ApiOperation({ summary: 'Liveness probe — is the gateway process running' })
  @ApiSingleResponse(LivenessResponseSchema)
  public live(): { status: 'ok'; service: 'gateway' } {
    return this.healthCheckService.getLiveness();
  }

  @Public()
  @Get('ready')
  @Contract({ request: EmptyRequestSchema, response: HealthResponseSchema })
  @ApiOperation({
    summary: 'Readiness probe — can the gateway currently serve requests',
    description:
      'Every reported dependency must be up: rabbitmq, serviceA, serviceB and redis (the request throttler is Redis-backed).',
  })
  @ApiSingleResponse(HealthResponseSchema)
  @ApiServiceUnavailableResponse({ schema: { example: DEGRADED_EXAMPLE } })
  public async ready(@Res({ passthrough: true }) response: Response): Promise<IAggregatedHealth> {
    const { ready, result } = await this.healthCheckService.getReadiness();

    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }
}
