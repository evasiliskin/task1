import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { MONGO_CLIENT, REDIS_CLIENT } from '@task1/shared/infra/client-tokens';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { connect, type Channel, type ChannelModel } from 'amqplib';

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

function fakeMongoClient(): unknown {
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const collection = {
    createIndex: vi.fn().mockResolvedValue('index'),
    find: vi.fn().mockReturnValue(cursor),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
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

export interface IHarnessOptions {
  realRedis?: boolean;
}

async function buildContext(
  url: string,
  stub: IOrchestrationStub,
  options: IHarnessOptions,
): Promise<INestApplication> {
  process.env.RABBITMQ_URL = url;

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ImportOrchestrationService)
    .useValue({
      importDownload: stub.importDownload ?? vi.fn().mockResolvedValue(undefined),
      importUpload: stub.importUpload ?? vi.fn().mockResolvedValue(undefined),
    })
    .overrideProvider(MONGO_CLIENT)
    .useValue(fakeMongoClient());

  const moduleReference = await (
    options.realRedis === true
      ? builder
      : builder.overrideProvider(REDIS_CLIENT).useValue(fakeRedisClient())
  ).compile();

  return moduleReference.createNestApplication();
}

export async function buildImportListener(
  url: string,
  stub: IOrchestrationStub,
  options: IHarnessOptions = {},
): Promise<INestApplication> {
  const application = await buildContext(url, stub, options);

  application.connectMicroservice(rmqOptions(url, 'service_a_imports_queue', 2), {
    inheritAppConfig: true,
  });
  await application.init();
  await application.startAllMicroservices();

  return application;
}

export async function buildBothListeners(
  url: string,
  stub: IOrchestrationStub,
  options: IHarnessOptions = {},
): Promise<INestApplication> {
  const application = await buildContext(url, stub, options);

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
