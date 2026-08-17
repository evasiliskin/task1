import { registerAs } from '@nestjs/config';
import { isProduction } from '@task1/shared/config/environment.helper';
import { z } from 'zod';

const swaggerConfigSchema = z.object({
  enabled: z.boolean(),
});

export type SwaggerConfiguration = z.infer<typeof swaggerConfigSchema>;

export default registerAs('swagger', (): SwaggerConfiguration =>
  swaggerConfigSchema.parse({
    enabled:
      process.env.SWAGGER_ENABLED === undefined
        ? !isProduction()
        : process.env.SWAGGER_ENABLED === 'true',
  }),
);
