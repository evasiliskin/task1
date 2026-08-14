import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { listResponseSchema } from '../schemas/list-response.schema.js';

import { ApiListResponse, ApiSingleResponse } from './api-envelope-response.decorator.js';

const API_RESPONSE_METADATA = 'swagger/apiResponse';

function readResponses(
  handler: unknown,
): Record<string, { schema?: unknown; description?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Reflect.getMetadata is typed as `any`; the shape is asserted by the tests below.
  return Reflect.getMetadata(API_RESPONSE_METADATA, handler);
}

describe('ApiSingleResponse', () => {
  it('should document a 200 response wrapping the schema under result.data, when no status is given', () => {
    class TestController {
      @ApiSingleResponse(z.object({ importId: z.string() }))
      public handle(): string {
        return 'ok';
      }
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- the prototype method reference is read for its attached metadata only and is never invoked with `this`.
    const responses = readResponses(TestController.prototype.handle);

    expect(responses[HttpStatus.OK].schema).toMatchObject({
      properties: {
        result: { properties: { data: { properties: { importId: { type: 'string' } } } } },
      },
    });
  });

  it('should document the requested status, when one is given', () => {
    class TestController {
      @ApiSingleResponse(z.object({ importId: z.string() }), { status: HttpStatus.ACCEPTED })
      public handle(): string {
        return 'ok';
      }
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- the prototype method reference is read for its attached metadata only and is never invoked with `this`.
    const responses = readResponses(TestController.prototype.handle);

    expect(Object.keys(responses)).toEqual([String(HttpStatus.ACCEPTED)]);
  });

  it('should carry the description through, when one is given', () => {
    class TestController {
      @ApiSingleResponse(z.object({}), { description: 'Always returned' })
      public handle(): string {
        return 'ok';
      }
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- the prototype method reference is read for its attached metadata only and is never invoked with `this`.
    const responses = readResponses(TestController.prototype.handle);

    expect(responses[HttpStatus.OK]).toMatchObject({ description: 'Always returned' });
  });
});

describe('ApiListResponse', () => {
  it('should document items and pagination directly under result, when applied to a list handler', () => {
    const { shape } = listResponseSchema(z.object({ id: z.string() }));

    class TestController {
      @ApiListResponse(shape)
      public handle(): string {
        return 'ok';
      }
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method -- the prototype method reference is read for its attached metadata only and is never invoked with `this`.
    const responses = readResponses(TestController.prototype.handle);

    expect(responses[HttpStatus.OK].schema).toMatchObject({
      properties: {
        result: { properties: { items: { type: 'array' }, pagination: { type: 'object' } } },
      },
    });
  });
});
