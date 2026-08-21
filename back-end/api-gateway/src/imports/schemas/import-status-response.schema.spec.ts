import { ImportStatusResponseSchema } from './import-status-response.schema.js';

describe('ImportStatusResponseSchema', () => {
  it('should accept a minimal started status payload, when parsed', () => {
    const result = ImportStatusResponseSchema.safeParse({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      source: { type: 'download', archive: '2026-08-11-0.json.gz' },
      status: 'started',
      startedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('should accept a full completed status payload, when parsed', () => {
    const result = ImportStatusResponseSchema.safeParse({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      source: { type: 'upload', filename: 'archive.json.gz' },
      status: 'completed',
      startedAt: '2026-08-11T00:00:00.000Z',
      completedAt: '2026-08-11T00:05:00.000Z',
      eventsProcessed: 10,
      validEvents: 10,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });

    expect(result.success).toBe(true);
  });

  it('should reject an unknown status value, when parsed', () => {
    const result = ImportStatusResponseSchema.safeParse({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      source: { type: 'download' },
      status: 'unknown',
      startedAt: '2026-08-11T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
