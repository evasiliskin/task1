import { toImportStatusView } from './to-import-status-view.js';

const DOCUMENT = {
  importId: '11111111-1111-4111-8111-111111111111',
  source: { type: 'download' as const, archive: '2026-08-11-0.json.gz' },
  status: 'started' as const,
  startedAt: new Date('2026-08-11T00:00:00.000Z'),
};

const COMPLETED_DOCUMENT = {
  ...DOCUMENT,
  status: 'completed' as const,
  completedAt: new Date('2026-08-11T00:05:00.000Z'),
  eventsProcessed: 100,
  validEvents: 95,
  invalidEvents: 5,
  duplicateEvents: 2,
};

const FAILED_DOCUMENT = {
  ...DOCUMENT,
  status: 'failed' as const,
  failedAt: new Date('2026-08-11T00:05:00.000Z'),
  errorCount: 1,
  errorSamples: ['boom'],
};

describe('toImportStatusView', () => {
  it('should serialise startedAt as an ISO string, when a document is mapped', () => {
    expect(toImportStatusView(DOCUMENT).startedAt).toBe('2026-08-11T00:00:00.000Z');
  });

  it('should omit completedAt, failedAt, counters and errorSamples, when they are absent from the document', () => {
    const view = toImportStatusView(DOCUMENT);

    expect(view).not.toHaveProperty('completedAt');
    expect(view).not.toHaveProperty('failedAt');
    expect(view).not.toHaveProperty('eventsProcessed');
    expect(view).not.toHaveProperty('validEvents');
    expect(view).not.toHaveProperty('invalidEvents');
    expect(view).not.toHaveProperty('duplicateEvents');
    expect(view).not.toHaveProperty('errorCount');
    expect(view).not.toHaveProperty('errorSamples');
  });

  it('should include completedAt and counters, serialised, when present on a completed document', () => {
    expect(toImportStatusView(COMPLETED_DOCUMENT)).toMatchObject({
      completedAt: '2026-08-11T00:05:00.000Z',
      eventsProcessed: 100,
      validEvents: 95,
      invalidEvents: 5,
      duplicateEvents: 2,
    });
  });

  it('should include failedAt, errorCount and errorSamples, serialised, when present on a failed document', () => {
    expect(toImportStatusView(FAILED_DOCUMENT)).toMatchObject({
      failedAt: '2026-08-11T00:05:00.000Z',
      errorCount: 1,
      errorSamples: ['boom'],
    });
  });

  it('should produce the same JSON as the raw document, when it has no optional fields', () => {
    expect(JSON.stringify(toImportStatusView(DOCUMENT))).toBe(JSON.stringify(DOCUMENT));
  });

  it('should produce the same JSON as the raw document, when the import completed', () => {
    expect(JSON.stringify(toImportStatusView(COMPLETED_DOCUMENT))).toBe(
      JSON.stringify(COMPLETED_DOCUMENT),
    );
  });

  it('should produce the same JSON as the raw document, when the import failed', () => {
    expect(JSON.stringify(toImportStatusView(FAILED_DOCUMENT))).toBe(
      JSON.stringify(FAILED_DOCUMENT),
    );
  });
});
