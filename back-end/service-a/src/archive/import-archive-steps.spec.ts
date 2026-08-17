import {
  buildCompletionMetrics,
  buildFailureMetrics,
  buildImportSource,
  shouldDeleteArchive,
  toCompletedEvent,
  toFailedEvent,
  toStartedEvent,
} from './import-archive-steps.js';

const IMPORT_ID = '11111111-1111-4111-8111-111111111111';
const STARTED_AT = new Date('2026-08-11T00:00:00.000Z');
const FINISHED_AT = new Date('2026-08-11T00:05:00.000Z');

const RESULT = {
  eventsProcessed: 100,
  validEvents: 90,
  invalidEvents: 7,
  duplicateEvents: 1,
  errorCount: 2,
};

describe('buildImportSource', () => {
  it('should label the import by its archive hour, when the source is a download', () => {
    expect(buildImportSource({ type: 'download', dateHour: '2026-08-11-0' })).toEqual({
      archiveLabel: '2026-08-11-0.json.gz',
      sourceRecord: { type: 'download', archive: '2026-08-11-0.json.gz' },
    });
  });

  it('should label the import by its basename, when the source is an upload', () => {
    expect(
      buildImportSource({ type: 'upload', filePath: `/data/archives/${IMPORT_ID}.json.gz` }),
    ).toEqual({
      archiveLabel: `${IMPORT_ID}.json.gz`,
      sourceRecord: { type: 'upload', filename: `${IMPORT_ID}.json.gz` },
    });
  });
});

describe('buildCompletionMetrics', () => {
  it('should report duration, processed and invalid counts, when metrics are built', () => {
    const metrics = buildCompletionMetrics({ ...RESULT, errorCount: 0 }, 1234);

    expect(metrics).toEqual([
      ['service_a.archive.processing.duration', 1234],
      ['service_a.archive.events.processed', 100],
      ['service_a.archive.events.invalid', 7],
    ]);
  });

  it('should append the error metric, when there were errors', () => {
    expect(buildCompletionMetrics(RESULT, 1234)).toHaveLength(4);
    expect(buildCompletionMetrics({ ...RESULT, errorCount: 0 }, 1234)).toHaveLength(3);
  });
});

describe('buildFailureMetrics', () => {
  it('should return a failed counter of one and the elapsed duration, when the import failed', () => {
    const metrics = buildFailureMetrics(4567);

    expect(metrics).toEqual([
      ['service_a.archive.imports.failed', 1],
      ['service_a.archive.failure.duration', 4567],
    ]);
  });

  it('should key both entries under the service_a.archive namespace, when called', () => {
    const keys = buildFailureMetrics(4567).map(([key]) => key);

    expect(keys.every((key) => key.startsWith('service_a.archive.'))).toBe(true);
  });

  it('should return a zero duration, when the failure happened immediately', () => {
    expect(buildFailureMetrics(0)).toEqual([
      ['service_a.archive.imports.failed', 1],
      ['service_a.archive.failure.duration', 0],
    ]);
  });
});

describe('event builders', () => {
  it('should build the started event, when an import begins', () => {
    expect(toStartedEvent(IMPORT_ID, 'a.json.gz', STARTED_AT)).toEqual({
      importId: IMPORT_ID,
      archive: 'a.json.gz',
      startedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('should build the completed event with every counter, when an import finishes', () => {
    expect(toCompletedEvent(IMPORT_ID, 'a.json.gz', STARTED_AT, FINISHED_AT, RESULT)).toEqual({
      importId: IMPORT_ID,
      archive: 'a.json.gz',
      startedAt: '2026-08-11T00:00:00.000Z',
      completedAt: '2026-08-11T00:05:00.000Z',
      ...RESULT,
    });
  });

  it('should build the failed event with the reason, when an import fails', () => {
    expect(toFailedEvent(IMPORT_ID, 'a.json.gz', STARTED_AT, FINISHED_AT, 'mongo down')).toEqual({
      importId: IMPORT_ID,
      archive: 'a.json.gz',
      startedAt: '2026-08-11T00:00:00.000Z',
      failedAt: '2026-08-11T00:05:00.000Z',
      reason: 'mongo down',
    });
  });
});

describe('shouldDeleteArchive', () => {
  it('should delete the archive, when it was downloaded', () => {
    const source = { type: 'download', dateHour: '2026-08-11-0' } as const;

    expect(shouldDeleteArchive(source, false)).toBe(true);
    expect(shouldDeleteArchive(source, true)).toBe(true);
  });

  it('should keep the archive, when an uploaded import failed', () => {
    const source = { type: 'upload', filePath: '/data/a.json.gz' } as const;

    expect(shouldDeleteArchive(source, true)).toBe(false);
    expect(shouldDeleteArchive(source, false)).toBe(true);
  });
});
