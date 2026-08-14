import { Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MissingContractError } from '@task1/shared/errors/index';
import { z } from 'zod';

import { Contract } from '../decorators/contract.decorator.js';

import { ContractScanner } from './contract-scanner.js';

class ContractedController {
  @Get()
  @Contract({ request: z.object({}), response: z.object({ ok: z.boolean() }) })
  public handle(): void {
    // body intentionally empty
  }
}

class UncontractedController {
  @Get()
  public handle(): void {
    // no @Contract on purpose
  }
}

function makeDiscoveryService(instances: object[]): {
  getControllers: () => { instance: object }[];
} {
  return { getControllers: () => instances.map((instance) => ({ instance })) };
}

describe('ContractScanner', () => {
  it('should not throw, when every discovered controller handler has a @Contract', () => {
    const scanner = new ContractScanner(
      makeDiscoveryService([new ContractedController()]) as never,
      new Reflector(),
    );

    expect(() => scanner.onModuleInit()).not.toThrow();
  });

  it('should throw MissingContractError, when a discovered controller handler has no @Contract', () => {
    const scanner = new ContractScanner(
      makeDiscoveryService([new UncontractedController()]) as never,
      new Reflector(),
    );

    expect(() => scanner.onModuleInit()).toThrow(MissingContractError);
  });
});
