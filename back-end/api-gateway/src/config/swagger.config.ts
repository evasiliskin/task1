import { registerAs } from '@nestjs/config';
import { isProduction } from '@task1/shared/config/environment.helper';
import { z } from 'zod';

const swaggerConfigSchema = z.object({
  enabled: z.boolean(),
});

export type SwaggerConfiguration = z.infer<typeof swaggerConfigSchema>;

export default registerAs('swagger', (): SwaggerConfiguration =>
  swaggerConfigSchema.parse({
    // Explicit comparison, deliberately NOT `z.coerce.boolean()`: Zod's boolean coercion is
    // `Boolean(value)`, so the string 'false' coerces to `true` and setting this flag to the
    // string "false" would publish the whole internal API surface. Only the exact string
    // 'true' enables.
    //
    // The NODE_ENV-derived default is computed here, inside the factory, rather than via Zod's
    // `.default()` on the schema: `.default(!isProduction())` would evaluate `isProduction()`
    // once when the schema is built (module load time) and freeze that value, so a later
    // `NODE_ENV` change would not be reflected on subsequent calls.
    enabled:
      process.env.SWAGGER_ENABLED === undefined
        ? !isProduction()
        : process.env.SWAGGER_ENABLED === 'true',
  }),
);
