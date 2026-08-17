import { z } from 'zod';

import { toFieldErrors } from './zod-issues-to-field-errors.js';

function issuesFor(schema: z.ZodType, input: unknown): readonly z.core.$ZodIssue[] {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    throw new Error('Expected the schema to reject this input');
  }

  return parsed.error.issues;
}

describe('toFieldErrors', () => {
  it('should strip the leading query segment, when the issue path starts with query', () => {
    const schema = z.object({ query: z.object({ limit: z.number() }) });

    const [fieldError] = toFieldErrors(issuesFor(schema, { query: { limit: 'ten' } }));

    expect(fieldError?.field).toBe('limit');
  });

  it('should strip the leading body segment and join the remaining path, when nested', () => {
    const schema = z.object({ body: z.object({ position: z.object({ latitude: z.number() }) }) });

    const [fieldError] = toFieldErrors(
      issuesFor(schema, { body: { position: { latitude: 'north' } } }),
    );

    expect(fieldError?.field).toBe('position.latitude');
  });

  it('should upper-case the issue code into errorType, when mapping an issue', () => {
    const schema = z.object({ query: z.object({ limit: z.number() }) });

    const [fieldError] = toFieldErrors(issuesFor(schema, { query: { limit: 'ten' } }));

    expect(fieldError?.errorType).toBe('INVALID_TYPE');
  });

  it('should expose max as a constraint, when the value is too big', () => {
    const schema = z.object({ query: z.object({ limit: z.number().max(200) }) });

    const [fieldError] = toFieldErrors(issuesFor(schema, { query: { limit: 500 } }));

    expect(fieldError?.errorType).toBe('TOO_BIG');
    expect(fieldError?.constraints).toEqual({ max: 200 });
  });

  it('should expose min as a constraint, when the value is too small', () => {
    const schema = z.object({ query: z.object({ latitude: z.number().min(-90) }) });

    const [fieldError] = toFieldErrors(issuesFor(schema, { query: { latitude: -200 } }));

    expect(fieldError?.constraints).toEqual({ min: -90 });
  });

  it('should omit constraints, when the issue carries no numeric bound', () => {
    const schema = z.object({ query: z.object({ limit: z.number() }) });

    const [fieldError] = toFieldErrors(issuesFor(schema, { query: { limit: 'ten' } }));

    expect(fieldError?.constraints).toBeUndefined();
  });

  it('should keep the full path, when the first segment is not a request section', () => {
    const schema = z.object({ latitude: z.number() });

    const [fieldError] = toFieldErrors(issuesFor(schema, { latitude: 'north' }));

    expect(fieldError?.field).toBe('latitude');
  });

  it('should map every issue, when several fields fail at once', () => {
    const schema = z.object({ query: z.object({ a: z.number(), b: z.number() }) });

    const fieldErrors = toFieldErrors(issuesFor(schema, { query: { a: 'x', b: 'y' } }));

    expect(fieldErrors).toHaveLength(2);
  });
});
