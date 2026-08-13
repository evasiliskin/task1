import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchEventsQueryDto } from './search-events-query.dto.js';

describe('SearchEventsQueryDto', () => {
  it('should default limit to 50 and produce no validation errors, when no query params are provided', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it('should produce no validation errors, when every field is well-formed', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, {
      type: 'PushEvent',
      repository: 'octocat/hello-world',
      actor: 'octocat',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      cursor: 'some-cursor',
      limit: '25',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(25);
  });

  it('should produce a validation error, when limit exceeds 200', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, { limit: '201' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when limit is zero', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, { limit: '0' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when from is not a valid ISO-8601 string', async () => {
    const dto = plainToInstance(SearchEventsQueryDto, { from: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
