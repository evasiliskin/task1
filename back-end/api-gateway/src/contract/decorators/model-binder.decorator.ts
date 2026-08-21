import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { RequestContractViolationError } from '@task1/shared/errors/index';
import { type z, type ZodType } from 'zod';

import { toFieldErrors } from '../validators/zod-issues-to-field-errors.js';

export interface IBoundRequest<TData> {
  readonly data: TData;
}

interface IRequestShape {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

type ExtractParameters<T> = T extends { params: infer P } ? P : object;
type ExtractQuery<T> = T extends { query: infer Q } ? Q : object;
type ExtractBody<T> = T extends { body: infer B } ? B : object;

export type MergeModelData<T> = ExtractBody<T> & ExtractQuery<T> & ExtractParameters<T>;

export type BoundRequest<TSchema extends ZodType> = IBoundRequest<MergeModelData<z.infer<TSchema>>>;

function buildValidationInput(request: IRequestShape): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  if (request.params !== undefined) {
    input.params = request.params;
  }

  if (request.query !== undefined) {
    input.query = request.query;
  }

  if (request.body !== undefined) {
    input.body = request.body;
  }

  return input;
}

function mergeParsedData(parsed: IRequestShape): Record<string, unknown> {
  return { ...(parsed.body ?? {}), ...(parsed.query ?? {}), ...(parsed.params ?? {}) };
}

export function bindRequest(schema: ZodType, context: ExecutionContext): IBoundRequest<unknown> {
  const request = context.switchToHttp().getRequest<IRequestShape>();
  const input = buildValidationInput(request);
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw new RequestContractViolationError({
      controllerName: context.getClass().name,
      methodName: context.getHandler().name,
      fieldErrors: toFieldErrors(parsed.error.issues),
    });
  }

  return { data: mergeParsedData(parsed.data as IRequestShape) };
}

interface IModelBinderInput {
  readonly schema: ZodType;
}

const modelBinderFactory = createParamDecorator(
  (input: IModelBinderInput, context: ExecutionContext): IBoundRequest<unknown> =>
    bindRequest(input.schema, context),
);

export const ModelBinder = (schema: ZodType): ParameterDecorator => modelBinderFactory({ schema });
