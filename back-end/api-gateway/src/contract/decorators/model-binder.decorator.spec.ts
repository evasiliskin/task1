import { type ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestContractViolationError } from '@task1/shared/errors/index';
import { z } from 'zod';

import { bindRequest, ModelBinder } from './model-binder.decorator.js';

interface IFakeRequest {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

function makeContext(request: IFakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => ({ name: 'TestController' }),
    getHandler: () => ({ name: 'testMethod' }),
  } as unknown as ExecutionContext;
}

describe('bindRequest', () => {
  it('should return merged data from params, query, and body, when all validate', () => {
    const schema = z.object({
      params: z.object({ id: z.string() }).strict(),
      query: z.object({ page: z.coerce.number() }).strict(),
      body: z.object({ name: z.string() }).strict(),
    });
    const context = makeContext({
      params: { id: 'p-1' },
      query: { page: '2' },
      body: { name: 'archive' },
    });

    const bound = bindRequest(schema, context);

    expect(bound).toEqual({ data: { id: 'p-1', page: 2, name: 'archive' } });
  });

  it('should apply a query default, when no query params are sent', () => {
    const schema = z.object({
      query: z
        .object({ limit: z.coerce.number().default(50) })
        .strict()
        .default({}),
    });
    const context = makeContext({ query: {} });

    const bound = bindRequest(schema, context);

    expect(bound).toEqual({ data: { limit: 50 } });
  });

  it('should throw RequestContractViolationError, when the input fails validation', () => {
    const schema = z.object({
      query: z.object({ limit: z.coerce.number().max(200) }).strict(),
    });
    const context = makeContext({ query: { limit: '500' } });

    expect(() => bindRequest(schema, context)).toThrow(RequestContractViolationError);
  });

  it('should throw RequestContractViolationError, when an unexpected key is present', () => {
    const schema = z.object({ query: z.object({ page: z.coerce.number() }).strict() });
    const context = makeContext({ query: { page: '1', unexpected: 'value' } });

    expect(() => bindRequest(schema, context)).toThrow(RequestContractViolationError);
  });
});

describe('ModelBinder', () => {
  it('should record non-undefined param data, when applied to a real handler parameter (regression guard for the createParamDecorator duck-typing collision)', () => {
    const schema = z.object({});

    class TestController {
      public handle(@ModelBinder(schema) _bound: unknown): void {
        // intentionally empty
      }
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handle') as Record<
      string,
      { data?: unknown }
    >;
    const [paramMetadata] = Object.values(metadata);

    expect(paramMetadata.data).toBeDefined();
  });
});
