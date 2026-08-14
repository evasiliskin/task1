import type { ZodTypeAny } from 'zod';

export interface IEndpointContract<
  TRequest extends ZodTypeAny = ZodTypeAny,
  TResponse extends ZodTypeAny = ZodTypeAny,
> {
  request: TRequest;
  response: TResponse;
}
