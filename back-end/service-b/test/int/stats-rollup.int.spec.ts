import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';

import {
  ensureProcessingLogIndexes,
  ensureProcessingLogRetentionIndex,
} from '../../src/processing-log/ensure-processing-log-indexes.js';
import { ProcessingLogTracker } from '../../src/processing-log/processing-log-tracker.service.js';
import { type IProcessingLogDocument } from '../../src/processing-log/processing-log.types.js';
import { buildStatsPipeline } from '../../src/processing-log/stats/build-stats-pipeline.js';
import { shapeStats, type IStatsGroup } from '../../src/processing-log/stats/shape-stats.js';
import { StatsRollupTracker } from '../../src/processing-log/stats/stats-rollup.tracker.js';
import { STATS_ROLLUP_ID } from '../../src/processing-log/stats/stats-rollup.types.js';

const RETENTION_MS = 2_592_000_000;

const IMPORT_ONE = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const IMPORT_TWO = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const IMPORT_THREE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const IMPORT_FOUR = 'e2d5a7c4-1b83-4f60-9a2e-7c5b4d1f8a03';

function buildEntry(
  importId: string,
  status: IProcessingLogDocument['status'],
  metadata: Record<string, number> = {},
): IProcessingLogDocument {
  return {
    importId,
    eventType: `github.import.${status}`,
    service: 'service-a',
    status,
    timestamp: new Date('2026-08-11T00:00:00Z'),
    correlationId: '8f14e45f-ceea-4e0a-9d1b-3a2e6f7c8b90',
    archive: `${importId}.json.gz`,
    metadata,
  };
}

describe('stats rollup against real MongoDB', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let logs: Collection<IProcessingLogDocument>;
  let rollups: Collection<never>;
  let tracker: ProcessingLogTracker;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  beforeEach(async () => {
    const database = client.db('service_b_int');

    logs = database.collection<IProcessingLogDocument>('processing-logs');
    rollups = database.collection('stats-rollups') as never;

    await logs.deleteMany({});
    await rollups.deleteMany({});
    await ensureProcessingLogIndexes(logs);
    await ensureProcessingLogRetentionIndex(logs, RETENTION_MS);
    await rollups.updateOne(
      { _id: STATS_ROLLUP_ID },
      { $set: { seededAt: new Date(0) } },
      { upsert: true },
    );

    tracker = new ProcessingLogTracker(logs, new StatsRollupTracker(rollups as never));
  });

  it('should produce the same totals as the aggregation, when the same events are applied', async () => {
    await tracker.upsertLog(buildEntry(IMPORT_ONE, 'started'));
    await tracker.upsertLog(
      buildEntry(IMPORT_ONE, 'completed', {
        eventsProcessed: 100,
        validEvents: 90,
        invalidEvents: 7,
        duplicateEvents: 1,
        errorCount: 3,
      }),
    );
    await tracker.upsertLog(
      buildEntry(IMPORT_TWO, 'completed', {
        eventsProcessed: 40,
        validEvents: 40,
        invalidEvents: 0,
        duplicateEvents: 0,
        errorCount: 0,
      }),
    );
    await tracker.upsertLog(buildEntry(IMPORT_THREE, 'failed'));

    const groups = await logs.aggregate<IStatsGroup>(buildStatsPipeline()).toArray();
    const fromAggregation = shapeStats(groups);
    const fromRollup = await new StatsRollupTracker(rollups as never).read();

    expect(fromRollup).toEqual(fromAggregation);
  });

  it('should not double-count, when an event is redelivered', async () => {
    const completed = buildEntry(IMPORT_ONE, 'completed', {
      eventsProcessed: 100,
      validEvents: 100,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });

    await tracker.upsertLog(completed);
    await tracker.upsertLog(completed);
    await tracker.upsertLog(completed);

    const fromRollup = await new StatsRollupTracker(rollups as never).read();

    expect(fromRollup).toMatchObject({ archivesProcessed: 1, eventsProcessed: 100 });
    await expect(logs.countDocuments({ importId: IMPORT_ONE, status: 'completed' })).resolves.toBe(
      1,
    );
  });

  it('should count the entry exactly once, when the process crashed after writing the log but before incrementing', async () => {
    const completed = buildEntry(IMPORT_FOUR, 'completed', {
      eventsProcessed: 100,
      validEvents: 100,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });

    await logs.insertOne({ ...completed });

    await tracker.upsertLog(completed);

    const fromRollup = await new StatsRollupTracker(rollups as never).read();

    expect(fromRollup).toMatchObject({ archivesProcessed: 1, eventsProcessed: 100 });
  });

  it('should count the entry exactly once, when the process crashed after incrementing but before stamping rolledUpAt', async () => {
    const completed = buildEntry(IMPORT_FOUR, 'completed', {
      eventsProcessed: 100,
      validEvents: 100,
      invalidEvents: 0,
      duplicateEvents: 0,
      errorCount: 0,
    });

    await tracker.upsertLog(completed);
    await logs.updateOne(
      { importId: IMPORT_FOUR, status: 'completed' },
      { $unset: { rolledUpAt: '' } },
    );

    await tracker.upsertLog(completed);

    const fromRollup = await new StatsRollupTracker(rollups as never).read();

    expect(fromRollup).toMatchObject({ archivesProcessed: 1, eventsProcessed: 100 });
  });

  it('should stay consistent with the aggregation, when an event has been redelivered', async () => {
    const entry = buildEntry(IMPORT_THREE, 'failed');

    await tracker.upsertLog(entry);
    await tracker.upsertLog(entry);

    const groups = await logs.aggregate<IStatsGroup>(buildStatsPipeline()).toArray();

    expect(await new StatsRollupTracker(rollups as never).read()).toEqual(shapeStats(groups));
  });

  it('should keep the rollup as a single document, when many events are applied', async () => {
    await tracker.upsertLog(buildEntry(IMPORT_ONE, 'completed', { eventsProcessed: 1 }));
    await tracker.upsertLog(buildEntry(IMPORT_TWO, 'completed', { eventsProcessed: 1 }));

    await expect(rollups.countDocuments({})).resolves.toBe(1);
    await expect(rollups.countDocuments({ _id: STATS_ROLLUP_ID })).resolves.toBe(1);
  });

  it('should create the TTL index with the configured expiry, when the service starts', async () => {
    const indexes = (await logs.listIndexes().toArray()) as {
      key: Record<string, number>;
      expireAfterSeconds?: number;
    }[];
    const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);

    expect(ttl).toBeDefined();
    expect(ttl?.key).toEqual({ timestamp: 1 });
    expect(ttl?.expireAfterSeconds).toBe(RETENTION_MS / 1000);
  });
});
