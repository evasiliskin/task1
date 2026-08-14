import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { isProduction } from './environment.helper.js';
import { requireInProduction } from './require-in-production.js';

const loggerConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  transport: z.enum(['json', 'pretty']).default('json'),
  serviceName: z.string().min(1),
});

export interface ILoggerConfiguration {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  transport: 'json' | 'pretty';
  /** Stamped on every log line so the three services stay distinguishable in one aggregator. */
  serviceName: string;
}

export default registerAs('logger', (): ILoggerConfiguration => {
  const parsed = loggerConfigSchema.parse({
    level: process.env.LOG_LEVEL,
    transport: process.env.APP_LOG_TRANSPORT === 'pretty' ? 'pretty' : undefined,
    serviceName: requireInProduction(process.env.SERVICE_NAME, 'SERVICE_NAME', 'unknown-service'),
  });

  return {
    level: parsed.level ?? (isProduction() ? 'info' : 'trace'),
    transport: parsed.transport,
    serviceName: parsed.serviceName,
  };
});
