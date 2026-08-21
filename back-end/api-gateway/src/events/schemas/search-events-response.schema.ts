import { type z } from 'zod';

import { listResponseSchema } from '../../contract/schemas/list-response.schema.js';

import { EventSchema } from './event.schema.js';

const { shape, schema } = listResponseSchema(EventSchema);

export const SearchEventsResultShape = shape;
export const SearchEventsResponseSchema = schema;

export type SearchEventsResponse = z.infer<typeof SearchEventsResponseSchema>;
