import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchLogsQueryDto } from './search-logs-query.dto.js';

describe('SearchLogsQueryDto', () => {
  const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('should default limit to 50 and produce no validation errors, when no query params are provided', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it('should produce no validation errors, when every field is well-formed', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, {
      importId,
      status: 'completed',
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
    const dto = plainToInstance(SearchLogsQueryDto, { limit: '201' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when limit is zero', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { limit: '0' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when importId is not a uuid', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { importId: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce a validation error, when status is not a known processing status', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { status: 'unknown' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  it('should produce no validation errors, when status is "dead-lettered"', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { status: 'dead-lettered' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should produce a validation error, when from is not a valid ISO-8601 string', async () => {
    const dto = plainToInstance(SearchLogsQueryDto, { from: 'not-a-date' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
