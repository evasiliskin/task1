import { Reflector } from '@nestjs/core';
import { z } from 'zod';

import { CONTRACT_METADATA, Contract } from './contract.decorator.js';

describe('Contract', () => {
  it('should attach the contract as reflectable metadata, when applied to a handler', () => {
    const requestSchema = z.object({});
    const responseSchema = z.object({ ok: z.boolean() });

    class TestController {
      @Contract({ request: requestSchema, response: responseSchema })
      public handle(): void {
        // intentionally empty — this method exists only to carry the decorator under test
      }
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method -- Reflector#get is typed to return `any`; the prototype method reference is read for its attached metadata only and is never invoked with `this`.
    const contract = reflector.get(CONTRACT_METADATA, TestController.prototype.handle);

    expect(contract).toEqual({ request: requestSchema, response: responseSchema });
  });
});
