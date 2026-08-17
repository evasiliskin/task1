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
  serviceName: string;
}

export default registerAs('logger', (): ILoggerConfiguration => {
  const parsed = loggerConfigSchema.parse({
    level: process.env.LOG_LEVEL,
    transport: process.env.APP_LOG_TRANSPORT === 'pretty' ? 'pretty' : undefined,
    serviceName: requireInProduction(process.env.SERVICE_NAME, 'SERVICE_NAME', 'unknown-service'),
  });

  if (parsed.transport === 'pretty' && isProduction()) {
    throw new Error(
      'APP_LOG_TRANSPORT=pretty is not supported in production; pino-pretty is a development-only dependency',
    );
  }

  return {
    level: parsed.level ?? (isProduction() ? 'info' : 'trace'),
    transport: parsed.transport,
    serviceName: parsed.serviceName,
  };
});
