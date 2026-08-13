import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GetReportQueryDto } from './get-report-query.dto.js';

describe('GetReportQueryDto', () => {
  it('should produce no validation errors, when importId is omitted', async () => {
    const dto = plainToInstance(GetReportQueryDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.importId).toBeUndefined();
  });

  it('should produce no validation errors, when importId is a valid uuid', async () => {
    const importId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const dto = plainToInstance(GetReportQueryDto, { importId });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.importId).toBe(importId);
  });

  it('should produce a validation error, when importId is not a uuid', async () => {
    const dto = plainToInstance(GetReportQueryDto, { importId: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
