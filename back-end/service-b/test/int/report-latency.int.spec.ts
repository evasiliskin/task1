import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';

import {
  ensureProcessingLogIndexes,
  ensureProcessingLogRetentionIndex,
} from '../../src/processing-log/ensure-processing-log-indexes.js';
import { ProcessingLogTracker } from '../../src/processing-log/processing-log-tracker.service.js';
import { type IProcessingLogDocument } from '../../src/processing-log/processing-log.types.js';
import { getStats } from '../../src/processing-log/stats/get-stats.js';
import { StatsRollupTracker } from '../../src/processing-log/stats/stats-rollup.tracker.js';
import { STATS_ROLLUP_ID } from '../../src/processing-log/stats/stats-rollup.types.js';
import { buildReport } from '../../src/reports/build-report.js';

const RETENTION_MS = 2_592_000_000;
/** The gateway's default rpcTimeoutMs; generation must stay well inside it. */
const RPC_BUDGET_MS = 10_000;
const IMPORT_COUNT = 5000;

describe('report generation latency', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let reportDirectory: string;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    reportDirectory = mkdtempSync(join(tmpdir(), 'report-latency-'));
  }, 180_000);

  afterAll(async () => {
    rmSync(reportDirectory, { recursive: true, force: true });
    await client.close();
    await container.stop();
  });

  it('should generate an aggregate report well inside the RPC budget', async () => {
    const database = client.db('service_b_latency');
    const logs = database.collection<IProcessingLogDocument>('processing-logs');
    const rollups = database.collection('stats-rollups');

    await ensureProcessingLogIndexes(logs);
    await ensureProcessingLogRetentionIndex(logs, RETENTION_MS);

    const rollupTracker = new StatsRollupTracker(rollups as never);
    const tracker = new ProcessingLogTracker(logs, rollupTracker);

    for (let index = 0; index < IMPORT_COUNT; index += 1) {
      await tracker.upsertLog({
        importId: `import-${index}`,
        eventType: 'github.import.completed',
        service: 'service-a',
        status: 'completed',
        timestamp: new Date(),
        correlationId: '11111111-1111-4111-8111-111111111111',
        archive: `${index}.json.gz`,
        metadata: { eventsProcessed: 100, validEvents: 99, invalidEvents: 1, errorCount: 0 },
      });
    }

    // `StatsRollupTracker.read()` treats an unseeded rollup document as "no rollup yet" and falls
    // back to the old full-collection `$group` scan (`buildStatsPipeline()`); without this, the
    // measured latency below would demonstrate the old scan is fast, not that `getStats` reads
    // the single-document rollup instead of scanning all 5,000 logs.
    await rollups.updateOne(
      { _id: STATS_ROLLUP_ID },
      { $set: { seededAt: new Date(0) } },
      { upsert: true },
    );

    const metricsReader = {
      readAverageProcessingDuration: () => Promise.resolve({ value: 42, degraded: false }),
      readEventsTimeSeries: () => Promise.resolve({ timeSeries: [], degraded: false }),
    };

    const startedAt = Date.now();
    const stats = await getStats({
      collection: logs,
      rollup: rollupTracker,
      metricsReader: metricsReader as never,
    });
    const reportPath = join(reportDirectory, 'aggregate.pdf');

    await buildReport(stats, reportPath, true);
    const durationMs = Date.now() - startedAt;

    expect(stats.archivesProcessed).toBe(IMPORT_COUNT);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-generated paths are safe
    expect(statSync(reportPath).size).toBeGreaterThan(0);
    // Generous ceiling: the point is that cost no longer scales with collection size.
    expect(durationMs).toBeLessThan(RPC_BUDGET_MS / 2);
  }, 300_000);
});
