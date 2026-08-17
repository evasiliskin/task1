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

  /**
   * Collects every method reachable on the instance, nearest prototype first.
   *
   * Own-prototype-only traversal skipped handlers inherited from a base controller: they still carry
   * `@Get`/`@Post` metadata and still serve traffic, so the startup guarantee would quietly stop
   * covering them. Nearest-first means an override's metadata wins over the method it replaces,
   * which matches what actually executes.
   */
  private collectHandlers(instance: object): Map<string, unknown> {
    const handlers = new Map<string, unknown>();
    let prototype: object | null = Object.getPrototypeOf(instance) as object | null;

    while (prototype !== null && prototype !== Object.prototype) {
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === 'constructor' || handlers.has(methodName)) {
          continue;
        }

        const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);

        if (typeof descriptor?.value === 'function') {
          handlers.set(methodName, descriptor.value);
        }
      }

      prototype = Object.getPrototypeOf(prototype) as object | null;
    }

    return handlers;
  }

  private assertHandlersHaveContract(instance: object): void {
    const controllerName = (instance.constructor as { name?: string }).name ?? 'Unknown';

    for (const [methodName, handler] of this.collectHandlers(instance)) {
      const httpMethod = this.reflector.get<number | undefined>(
        NEST_HTTP_METHOD_METADATA_KEY,
        handler as (...arguments_: unknown[]) => unknown,
      );

      if (httpMethod === undefined) {
        continue;
      }

      const contract = this.reflector.get<unknown>(
        CONTRACT_METADATA,
        handler as (...arguments_: unknown[]) => unknown,
      );

      if (contract === undefined) {
        throw new MissingContractError({ controllerName, methodName });
      }
    }
  }
}
