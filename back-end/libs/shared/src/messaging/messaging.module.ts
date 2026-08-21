import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';

import { LoggerModule } from '../logger/rmq/logger.module.js';

import {
  MESSAGING_OPTIONS,
  QUEUE_TOPOLOGY,
  RABBITMQ_URL,
  RETRY_POLICY,
} from './messaging.tokens.js';
import { QueueTopologyInitializer } from './queue-topology.initializer.js';
import { deriveQueueTopology } from './queue-topology.js';
import { type IRetryPolicy, RetryPublisher } from './retry-publisher.js';

export interface IMessagingModuleOptions {
  mainQueue: string;
  policy: IRetryPolicy;
  rabbitmqUrl: string;
}

export interface IMessagingModuleAsyncOptions {
  inject: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...arguments_: never[]) => IMessagingModuleOptions;
}

@Module({})
export class MessagingModule {
  public static forQueueAsync(options: IMessagingModuleAsyncOptions): DynamicModule {
    return {
      module: MessagingModule,
      global: true,
      imports: [LoggerModule],
      providers: [
        {
          provide: MESSAGING_OPTIONS,
          inject: options.inject,
          useFactory: options.useFactory,
        },
        {
          provide: QUEUE_TOPOLOGY,
          inject: [MESSAGING_OPTIONS],
          useFactory: (resolved: IMessagingModuleOptions) =>
            deriveQueueTopology(resolved.mainQueue),
        },
        {
          provide: RETRY_POLICY,
          inject: [MESSAGING_OPTIONS],
          useFactory: (resolved: IMessagingModuleOptions) => resolved.policy,
        },
        {
          provide: RABBITMQ_URL,
          inject: [MESSAGING_OPTIONS],
          useFactory: (resolved: IMessagingModuleOptions) => resolved.rabbitmqUrl,
        },
        RetryPublisher,
        QueueTopologyInitializer,
      ],
      exports: [RetryPublisher, QUEUE_TOPOLOGY],
    };
  }
}
