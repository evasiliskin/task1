import { registerAs } from '@nestjs/config';
import { z } from 'zod';

import { isProduction } from './environment.helper';

const loggerConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  transport: z.enum(['json', 'pretty']).default('json'),
});

export interface ILoggerConfiguration {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  transport: 'json' | 'pretty';
}

export default registerAs('logger', (): ILoggerConfiguration => {
  const parsed = loggerConfigSchema.parse({
    level: process.env.LOG_LEVEL,
    transport: process.env.APP_LOG_TRANSPORT === 'pretty' ? 'pretty' : undefined,
  });

  return {
    level: parsed.level ?? (isProduction() ? 'info' : 'trace'),
    transport: parsed.transport,
  };
});
