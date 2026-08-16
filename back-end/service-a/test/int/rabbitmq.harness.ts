import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { connect, type Channel, type ChannelModel } from 'amqplib';

import { MONGO_CLIENT, REDIS_CLIENT } from '@task1/shared/infra/client-tokens';

import { AppModule } from '../../src/app.module.js';
import { ImportOrchestrationService } from '../../src/archive/import-orchestration.service.js';

export interface IRabbitMqHarness {
  url: string;
  channel: Channel;
  stop: () => Promise<void>;
}

export async function startRabbitMq(): Promise<IRabbitMqHarness> {
  const container: StartedRabbitMQContainer = await new RabbitMQContainer(
    'rabbitmq:3-management-alpine',
  ).start();

  const url = container.getAmqpUrl();
  const connection: ChannelModel = await connect(url);
  const channel = await connection.createChannel();

  return {
    url,
    channel,
    stop: async () => {
      await channel.close();
      await connection.close();
      await container.stop();
    },
  };
}

export async function queueDepth(channel: Channel, queue: string): Promise<number> {
  const { messageCount } = await channel.checkQueue(queue);

  return messageCount;
}

export interface IOrchestrationStub {
  importDownload?: (dateHour: string, importId: string) => Promise<unknown>;
  importUpload?: (filePath: string, importId: string) => Promise<unknown>;
}

function rmqOptions(url: string, queue: string, prefetchCount: number): MicroserviceOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue,
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': `${queue}.dlq`,
        },
      },
      noAck: false,
      prefetchCount,
    },
  };
}

/**
 * These integration tests exercise RabbitMQ behaviour only (message delivery, retry,
 * dead-lettering, prefetch isolation) — nothing here touches Mongo or Redis data. Real
 * MongoClient/Redis clients are swapped for minimal fakes so `application.init()` never dials
 * localhost:27017/6379, which docker-compose.yml doesn't expose to the host. The fakes only
 * implement what's actually invoked while the DI graph boots:
 *  - Mongo: `.connect()`/`.close()` (MongoConnectionService lifecycle),
 *    `.db().collection().createIndex()` (EnsureEventIndexesInitializer /
 *    EnsureImportIndexesInitializer, which run in onModuleInit), and the
 *    `.find().sort().limit().toArray()` chain (EventsSearchService, exercised by the
 *    prefetch-isolation test's `events.search` RPC while the import queue is saturated — the
 *    fake just needs to answer, not return real data).
 *  - Redis: `.connect()`/`.quit()` (RedisConnectionService lifecycle) and `.call()`
 *    (MetricsService.recordMetric, fired as a side effect of that same `events.search` RPC).
 */
function fakeMongoClient(): unknown {
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const collection = {
    createIndex: vi.fn().mockResolvedValue('index'),
    find: vi.fn().mockReturnValue(cursor),
  };

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    db: vi.fn().mockReturnValue({ collection: vi.fn().mockReturnValue(collection) }),
  };
}

function fakeRedisClient(): unknown {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
    call: vi.fn().mockResolvedValue(undefined),
  };
}

async function buildContext(url: string, stub: IOrchestrationStub): Promise<INestApplication> {
  process.env.RABBITMQ_URL = url;

  const moduleReference = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ImportOrchestrationService)
    .useValue({
      importDownload: stub.importDownload ?? vi.fn().mockResolvedValue(undefined),
      importUpload: stub.importUpload ?? vi.fn().mockResolvedValue(undefined),
    })
    .overrideProvider(MONGO_CLIENT)
    .useValue(fakeMongoClient())
    .overrideProvider(REDIS_CLIENT)
    .useValue(fakeRedisClient())
    .compile();

  return moduleReference.createNestApplication();
}

/** Boots only the import listener — used by the redelivery and dead-letter tests. */
export async function buildImportListener(
  url: string,
  stub: IOrchestrationStub,
): Promise<INestApplication> {
  const application = await buildContext(url, stub);

  application.connectMicroservice(rmqOptions(url, 'service_a_imports_queue', 2), {
    inheritAppConfig: true,
  });
  await application.init();
  await application.startAllMicroservices();

  return application;
}

/** Boots both listeners — used by the prefetch-isolation test. */
export async function buildBothListeners(
  url: string,
  stub: IOrchestrationStub,
): Promise<INestApplication> {
  const application = await buildContext(url, stub);

  application.connectMicroservice(rmqOptions(url, 'service_a_queue', 20), {
    inheritAppConfig: true,
  });
  application.connectMicroservice(rmqOptions(url, 'service_a_imports_queue', 2), {
    inheritAppConfig: true,
  });
  await application.init();
  await application.startAllMicroservices();

  return application;
}

/**
 * Publishes an RPC and awaits the reply on an exclusive queue, mirroring what NestJS's ClientProxy
 * does on the wire. Kept explicit rather than reusing ClientProxy so the test measures broker and
 * consumer behaviour, not client-library buffering.
 */
export async function sendRpc(
  channel: Channel,
  queue: string,
  pattern: string,
  data: unknown,
  timeoutMs = 10_000,
): Promise<unknown> {
  const replyQueue = await channel.assertQueue('', { exclusive: true });
  const correlationId = randomUUID();

  const reply = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`RPC ${pattern} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    channel
      .consume(
        replyQueue.queue,
        (message) => {
          if (message?.properties.correlationId !== correlationId) {
            return;
          }

          clearTimeout(timer);
          resolve(JSON.parse(message.content.toString('utf8')));
        },
        { noAck: true },
      )
      .catch(reject);
  });

  channel.sendToQueue(queue, Buffer.from(JSON.stringify({ pattern, data, id: correlationId })), {
    replyTo: replyQueue.queue,
    correlationId,
  });

  return await reply;
}
