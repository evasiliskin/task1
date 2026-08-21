import { Inject, Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { connect as amqpConnect } from 'amqplib';

import { type AppLogger } from '../logger/app-logger.js';
import { type ILoggerFactory } from '../logger/logger-factory.interface.js';
import { LOGGER_FACTORY } from '../logger/logger.tokens.js';

import { QUEUE_TOPOLOGY, RABBITMQ_URL } from './messaging.tokens.js';
import { buildRetryQueueArguments, type IQueueTopology } from './queue-topology.js';

const DECLARED_LOG = 'Declared retry and dead-letter queues';
const DECLARE_FAILED_LOG =
  'Could not declare retry/dead-letter queues at startup; they will be missing until the broker is reachable and the service restarts';

export type AmqpConnectFunction = (url: string) => Promise<{
  createChannel: () => Promise<{
    assertQueue: (queue: string, options?: unknown) => Promise<unknown>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
}>;

@Injectable()
export class QueueTopologyInitializer implements OnApplicationBootstrap {
  public constructor(
    @Inject(QUEUE_TOPOLOGY) private readonly topology: IQueueTopology,
    @Inject(RABBITMQ_URL) private readonly rabbitmqUrl: string,
    @Inject(LOGGER_FACTORY) loggerFactory: ILoggerFactory,
    @Optional()
    private readonly connect: AmqpConnectFunction = amqpConnect as unknown as AmqpConnectFunction,
  ) {
    this.logger = loggerFactory.getLogger(QueueTopologyInitializer.name);
  }

  public async onApplicationBootstrap(): Promise<void> {
    try {
      const connection = await this.connect(this.rabbitmqUrl);
      const channel = await connection.createChannel();

      await channel.assertQueue(this.topology.deadLetter, { durable: true });
      await channel.assertQueue(this.topology.retry, {
        durable: true,
        arguments: buildRetryQueueArguments(this.topology.main),
      });

      await channel.close();
      await connection.close();

      this.logger.info(
        { retryQueue: this.topology.retry, deadLetterQueue: this.topology.deadLetter },
        DECLARED_LOG,
      );
    } catch (error) {
      this.logger.warn({ mainQueue: this.topology.main }, DECLARE_FAILED_LOG, error);
    }
  }

  private readonly logger: AppLogger;
}
