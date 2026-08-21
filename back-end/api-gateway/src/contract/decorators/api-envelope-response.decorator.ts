import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { type ZodType } from 'zod';

import {
  listEnvelopeJsonSchema,
  singleEnvelopeJsonSchema,
} from '../schemas/envelope-json-schema.js';
import { toSwaggerSchema } from '../schemas/swagger-schema.js';

type EnvelopeResponseDecorator = MethodDecorator & ClassDecorator;

export interface IApiEnvelopeResponseOptions {
  status?: HttpStatus;
  description?: string;
}

export const ApiSingleResponse = (
  schema: ZodType,
  options: IApiEnvelopeResponseOptions = {},
): EnvelopeResponseDecorator =>
  ApiResponse({
    status: options.status ?? HttpStatus.OK,
    description: options.description,
    schema: singleEnvelopeJsonSchema(toSwaggerSchema(schema)),
  });

export const ApiListResponse = (
  shape: ZodType,
  options: IApiEnvelopeResponseOptions = {},
): EnvelopeResponseDecorator =>
  ApiResponse({
    status: options.status ?? HttpStatus.OK,
    description: options.description,
    schema: listEnvelopeJsonSchema(toSwaggerSchema(shape)),
  });
