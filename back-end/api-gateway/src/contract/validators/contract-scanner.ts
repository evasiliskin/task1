import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { MissingContractError } from '@task1/shared/errors/index';

import { CONTRACT_METADATA } from '../decorators/contract.decorator.js';

/** Matches NestJS `METHOD_METADATA` (`@nestjs/common/constants`). */
const NEST_HTTP_METHOD_METADATA_KEY = 'method';

@Injectable()
export class ContractScanner implements OnModuleInit {
  public constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  public onModuleInit(): void {
    const controllers = this.discoveryService.getControllers();

    for (const wrapper of controllers) {
      const instance = wrapper.instance as object | undefined;

      if (instance !== undefined && instance !== null) {
        this.assertHandlersHaveContract(instance);
      }
    }
  }

  private assertHandlersHaveContract(instance: object): void {
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(prototype);
    const controllerName = (instance.constructor as { name?: string }).name ?? 'Unknown';

    for (const methodName of methodNames) {
      if (methodName === 'constructor') {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      const handler = descriptor?.value as ((...arguments_: unknown[]) => unknown) | undefined;

      if (typeof handler !== 'function') {
        continue;
      }

      const httpMethod = this.reflector.get<number | undefined>(
        NEST_HTTP_METHOD_METADATA_KEY,
        handler,
      );

      if (httpMethod === undefined) {
        continue;
      }

      const contract = this.reflector.get<unknown>(CONTRACT_METADATA, handler);

      if (contract === undefined) {
        throw new MissingContractError({ controllerName, methodName });
      }
    }
  }
}
