import { type INestApplication } from '@nestjs/common';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  buildBothListeners,
  sendRpc,
  startRabbitMq,
  type IRabbitMqHarness,
} from './rabbitmq.harness.js';

const RPC_QUEUE = 'service_a_queue';
const REDIS_PORT = 6379;
const REDIS_STACK_IMAGE = 'redis/redis-stack-server:latest';

const CLAIM_REQUESTS_KEY = `service_a.rmq.${RPC_PATTERNS.IMPORTS_CLAIM}.requests`;
const CLAIM_ERRORS_KEY = `service_a.rmq.${RPC_PATTERNS.IMPORTS_CLAIM}.errors`;
const HEALTH_KEY_PATTERN = `service_a.rmq.${RPC_PATTERNS.HEALTH_CHECK}.*`;

describe('RMQ transport metrics against real Redis', () => {
  let harness: IRabbitMqHarness;
  let redisContainer: StartedTestContainer;
  let redis: Redis;
  let app: INestApplication;

  async function rangeLength(key: string): Promise<number> {
    const exists = await redis.exists(key);

    if (exists === 0) {
      return 0;
    }

    return ((await redis.call('TS.RANGE', key, '-', '+')) as unknown[]).length;
  }

  beforeAll(async () => {
    process.env.SERVICE_NAME = 'service-a';

    harness = await startRabbitMq();
    redisContainer = await new GenericContainer(REDIS_STACK_IMAGE)
      .withExposedPorts(REDIS_PORT)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start();

    process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${String(redisContainer.getMappedPort(REDIS_PORT))}`;
    redis = new Redis(process.env.REDIS_URL);

    app = await buildBothListeners(harness.url, {}, { realRedis: true });
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
    await redisContainer.stop();
    await harness.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('should publish a requests datapoint for imports.claim, when a claim RPC is handled', async () => {
    await sendRpc(harness.channel, RPC_QUEUE, RPC_PATTERNS.IMPORTS_CLAIM, {
      idempotencyKey: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });

    await vi.waitFor(
      async () => {
        expect(await rangeLength(CLAIM_REQUESTS_KEY)).toBe(1);
      },
      { timeout: 15_000 },
    );

    expect(await rangeLength(CLAIM_ERRORS_KEY)).toBe(0);
  });

  it('should publish an errors datapoint, when the handler rejects', async () => {
    await sendRpc(harness.channel, RPC_QUEUE, RPC_PATTERNS.IMPORTS_CLAIM, {});

    await vi.waitFor(
      async () => {
        expect(await rangeLength(CLAIM_ERRORS_KEY)).toBe(1);
      },
      { timeout: 15_000 },
    );

    expect(await rangeLength(CLAIM_REQUESTS_KEY)).toBe(1);
  });

  it('should publish nothing, when the health check pattern is handled', async () => {
    await sendRpc(harness.channel, RPC_QUEUE, RPC_PATTERNS.HEALTH_CHECK, {});

    await expect(redis.keys(HEALTH_KEY_PATTERN)).resolves.toEqual([]);
  });
});
