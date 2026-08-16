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
    correlationId: 'c1',
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
    // `StatsRollupTracker.read()` treats an unseeded rollup document as "no rollup yet" (falls back
    // to a live aggregation) — this suite tests the rollup itself, not that fallback, so it needs a
    // seeded document to read from. Real seeding is `StatsRollupSeedService`'s job, exercised
    // elsewhere; here it's a fixed marker predating every entry these tests apply.
    await rollups.updateOne(
      { _id: STATS_ROLLUP_ID },
      { $set: { seededAt: new Date(0) } },
      { upsert: true },
    );

    tracker = new ProcessingLogTracker(logs, new StatsRollupTracker(rollups as never));
  });

  it('should produce exactly what the old aggregation produced', async () => {
    await tracker.upsertLog(buildEntry('i1', 'started'));
    await tracker.upsertLog(
      buildEntry('i1', 'completed', {
        eventsProcessed: 100,
        validEvents: 90,
        invalidEvents: 7,
        duplicateEvents: 1,
        errorCount: 3,
      }),
    );
    await tracker.upsertLog(
      buildEntry('i2', 'completed', {
        eventsProcessed: 40,
        validEvents: 40,
        invalidEvents: 0,
        duplicateEvents: 0,
        errorCount: 0,
      }),
    );
    await tracker.upsertLog(buildEntry('i3', 'failed'));

    const groups = await logs.aggregate<IStatsGroup>(buildStatsPipeline()).toArray();
    const fromAggregation = shapeStats(groups);
    const fromRollup = await new StatsRollupTracker(rollups as never).read();

    expect(fromRollup).toEqual(fromAggregation);
  });

  it('should not double-count a redelivered event', async () => {
    const completed = buildEntry('i1', 'completed', {
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
    await expect(logs.countDocuments({ importId: 'i1' })).resolves.toBe(1);
  });

  it('should stay consistent with the aggregation after redelivery', async () => {
    const entry = buildEntry('i9', 'failed');

    await tracker.upsertLog(entry);
    await tracker.upsertLog(entry);

    const groups = await logs.aggregate<IStatsGroup>(buildStatsPipeline()).toArray();

    expect(await new StatsRollupTracker(rollups as never).read()).toEqual(shapeStats(groups));
  });

  it('should keep the rollup as a single document', async () => {
    await tracker.upsertLog(buildEntry('i1', 'completed', { eventsProcessed: 1 }));
    await tracker.upsertLog(buildEntry('i2', 'completed', { eventsProcessed: 1 }));

    await expect(rollups.countDocuments({})).resolves.toBe(1);
    await expect(rollups.countDocuments({ _id: STATS_ROLLUP_ID })).resolves.toBe(1);
  });

  it('should create the TTL index with the configured expiry', async () => {
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
