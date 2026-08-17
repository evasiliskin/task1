import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MissingContractError, ResponseContractViolationError } from '@task1/shared/errors/index';
import { firstValueFrom, of } from 'rxjs';
import { z } from 'zod';

import { Contract } from '../decorators/contract.decorator.js';

import { ContractValidationInterceptor } from './contract-validation.interceptor.js';

class UncontractedController {
  public handle(): boolean {
    return true;
  }
}

class ContractedController {
  @Contract({ request: z.object({}), response: z.object({ ok: z.boolean() }) })
  public handle(): boolean {
    return true;
  }
}

function makeContext(ControllerClass: new () => object, methodName: string): ExecutionContext {
  return {
    // eslint-disable-next-line security/detect-object-injection -- methodName is a test-authored literal, not user input.
    getHandler: () => (ControllerClass.prototype as Record<string, unknown>)[methodName],
    getClass: () => ControllerClass,
  } as unknown as ExecutionContext;
}

function makeCallHandler(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ContractValidationInterceptor', () => {
  const reflector = new Reflector();
  const interceptor = new ContractValidationInterceptor(reflector);

  it('should throw MissingContractError, when the handler has no @Contract metadata', async () => {
    const context = makeContext(UncontractedController, 'handle');

    await expect(
      firstValueFrom(interceptor.intercept(context, makeCallHandler({}))),
    ).rejects.toThrow(MissingContractError);
  });

  it('should throw ResponseContractViolationError, when the response fails the declared schema', async () => {
    const context = makeContext(ContractedController, 'handle');

    await expect(
      firstValueFrom(interceptor.intercept(context, makeCallHandler({ ok: 'not-a-boolean' }))),
    ).rejects.toThrow(ResponseContractViolationError);
  });

  it('should pass the response through unchanged, when it matches the declared schema', async () => {
    const context = makeContext(ContractedController, 'handle');

    const result = await firstValueFrom(
      interceptor.intercept(context, makeCallHandler({ ok: true })),
    );

    expect(result).toEqual({ ok: true });
  });
});
