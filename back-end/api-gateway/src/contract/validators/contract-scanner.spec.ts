import { Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MissingContractError } from '@task1/shared/errors/index';
import { z } from 'zod';

import { CONTRACT_METADATA, Contract } from '../decorators/contract.decorator.js';

import { ContractScanner } from './contract-scanner.js';

class ContractedController {
  @Get()
  @Contract({ request: z.object({}), response: z.object({ ok: z.boolean() }) })
  public handle(): boolean {
    return true;
  }
}

class UncontractedController {
  @Get()
  public handle(): boolean {
    return true;
  }
}

function makeDiscoveryService(instances: object[]): {
  getControllers: () => { instance: object }[];
} {
  return { getControllers: () => instances.map((instance) => ({ instance })) };
}

function buildScanner(controllers: { instance: object }[]): ContractScanner {
  return new ContractScanner({ getControllers: () => controllers } as never, new Reflector());
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

  it('should throw MissingContractError, when an inherited handler has no @Contract', () => {
    class BaseController {
      public list(): string {
        return 'ok';
      }
    }

    class ChildController extends BaseController {}

    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
    Reflect.defineMetadata('method', 0, BaseController.prototype.list);

    const scanner = buildScanner([{ instance: new ChildController() }]);

    expect(() => scanner.onModuleInit()).toThrow(MissingContractError);
  });

  it('should not throw, when an inherited handler has a @Contract', () => {
    class BaseController {
      public list(): string {
        return 'ok';
      }
    }

    class ChildController extends BaseController {}

    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
    Reflect.defineMetadata('method', 0, BaseController.prototype.list);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
    Reflect.defineMetadata(CONTRACT_METADATA, {}, BaseController.prototype.list);

    const scanner = buildScanner([{ instance: new ChildController() }]);

    expect(() => scanner.onModuleInit()).not.toThrow();
  });

  it('should throw MissingContractError, when an uncontracted override shadows a contracted base handler', () => {
    class BaseController {
      public list(): string {
        return 'base';
      }
    }

    class ChildController extends BaseController {
      public override list(): string {
        return 'child';
      }
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
    Reflect.defineMetadata('method', 0, BaseController.prototype.list);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
    Reflect.defineMetadata(CONTRACT_METADATA, {}, BaseController.prototype.list);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a Reflect metadata target, never invoked, so unbound `this` is not a risk
    Reflect.defineMetadata('method', 0, ChildController.prototype.list);

    const scanner = buildScanner([{ instance: new ChildController() }]);

    expect(() => scanner.onModuleInit()).toThrow(MissingContractError);
  });

  it('should not throw, when a discovered controller declares no handlers', () => {
    class PlainController {}

    const scanner = buildScanner([{ instance: new PlainController() }]);

    expect(() => scanner.onModuleInit()).not.toThrow();
  });
});
