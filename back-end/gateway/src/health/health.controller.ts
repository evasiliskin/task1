import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

interface IHealthResponse {
  status: 'ok';
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  public check(): IHealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
