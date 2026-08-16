import {
  buildCompletionMetrics,
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
  it('should label a download by its archive hour', () => {
    expect(buildImportSource({ type: 'download', dateHour: '2026-08-11-0' })).toEqual({
      archiveLabel: '2026-08-11-0.json.gz',
      sourceRecord: { type: 'download', archive: '2026-08-11-0.json.gz' },
    });
  });

  it('should label an upload by its basename', () => {
    expect(
      buildImportSource({ type: 'upload', filePath: `/data/archives/${IMPORT_ID}.json.gz` }),
    ).toEqual({
      archiveLabel: `${IMPORT_ID}.json.gz`,
      sourceRecord: { type: 'upload', filename: `${IMPORT_ID}.json.gz` },
    });
  });
});

describe('buildCompletionMetrics', () => {
  it('should always report duration, processed and invalid counts', () => {
    const metrics = buildCompletionMetrics({ ...RESULT, errorCount: 0 }, 1234);

    expect(metrics).toEqual([
      ['service_a.archive.processing.duration', 1234],
      ['service_a.archive.events.processed', 100],
      ['service_a.archive.events.invalid', 7],
    ]);
  });

  it('should append the error metric only when there were errors', () => {
    expect(buildCompletionMetrics(RESULT, 1234)).toHaveLength(4);
    expect(buildCompletionMetrics({ ...RESULT, errorCount: 0 }, 1234)).toHaveLength(3);
  });
});

describe('event builders', () => {
  it('should build the started event', () => {
    expect(toStartedEvent(IMPORT_ID, 'a.json.gz', STARTED_AT)).toEqual({
      importId: IMPORT_ID,
      archive: 'a.json.gz',
      startedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('should build the completed event with every counter', () => {
    expect(toCompletedEvent(IMPORT_ID, 'a.json.gz', STARTED_AT, FINISHED_AT, RESULT)).toEqual({
      importId: IMPORT_ID,
      archive: 'a.json.gz',
      startedAt: '2026-08-11T00:00:00.000Z',
      completedAt: '2026-08-11T00:05:00.000Z',
      ...RESULT,
    });
  });

  it('should build the failed event with the reason', () => {
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
  it('should always delete a downloaded archive', () => {
    const source = { type: 'download', dateHour: '2026-08-11-0' } as const;

    expect(shouldDeleteArchive(source, false)).toBe(true);
    expect(shouldDeleteArchive(source, true)).toBe(true);
  });

  it('should keep a failed upload for diagnosis but delete a successful one', () => {
    const source = { type: 'upload', filePath: '/data/a.json.gz' } as const;

    expect(shouldDeleteArchive(source, true)).toBe(false);
    expect(shouldDeleteArchive(source, false)).toBe(true);
  });
});
