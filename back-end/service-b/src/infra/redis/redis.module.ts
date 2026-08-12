import { Global, Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';

import redisConfig from '../../config/redis.config.js';
import { REDIS_CLIENT } from '../infra-clients.tokens.js';

import { RedisConnectionService } from './redis-connection.service.js';

@Global()
@Module({
  providers: [
    RedisConnectionService,
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => {
        const client = new Redis(config.url, { lazyConnect: true });

        // ioredis emits 'error' on a lazily-connected client before connect()
        // resolves or rejects; without a listener this crashes the process
        // (unhandled EventEmitter 'error' event). RedisConnectionService's own
        // connect() call surfaces real connection failures via its rejected
        // promise instead — this listener only prevents the process crash.
        // eslint-disable-next-line @typescript-eslint/no-empty-function -- deliberately swallowed; see comment above.
        client.on('error', () => {});

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
