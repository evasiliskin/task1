// back-end/service-a/scripts/bench-memory.ts
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { type IGithubEventDocument } from '@task1/shared/github-archive/index';
import { MongoClient } from 'mongodb';

import { downloadArchive } from '../src/archive/download/download-archive.js';
import { processArchive } from '../src/archive/processing/process-archive.js';
import archiveConfig from '../src/config/archive.config.js';
import mongodbConfig from '../src/config/mongodb.config.js';
import storageConfig from '../src/config/storage.config.js';

const SAMPLE_INTERVAL_MS = 1000;
const BYTES_PER_MB = 1024 * 1024;

function formatMb(bytes: number): string {
  return `${(bytes / BYTES_PER_MB).toFixed(1)}MB`;
}

function readFileSizeSafely(path: string): number {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from validated storage config + a CLI-provided dateHour, used only to sample its size for this diagnostic script.
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function startRssSampler(label: string, describeProgress: () => string): () => void {
  const timer = setInterval(() => {
    const { rss } = process.memoryUsage();
    // eslint-disable-next-line no-console -- this is a manually-run CLI diagnostic script, not application request-handling code.
    console.log(`[${label}] rss=${formatMb(rss)} ${describeProgress()}`);
  }, SAMPLE_INTERVAL_MS);

  return () => {
    clearInterval(timer);
  };
}

async function main(): Promise<void> {
  const dateHour = process.argv[2];

  if (dateHour === undefined) {
    throw new Error('Usage: pnpm --filter service-a run bench:memory <dateHour, e.g. 2026-08-11-0>');
  }

  const importId = randomUUID();
  const { dir: storageDirectory } = storageConfig();
  const { baseUrl, downloadTimeoutMs } = archiveConfig();
  const { uri: mongoUri, batchSize } = mongodbConfig();

  // eslint-disable-next-line no-console -- CLI diagnostic script.
  console.log(`Downloading ${dateHour} into ${storageDirectory} (importId=${importId})...`);

  // Mirrors download-archive.ts's own internal temp-file naming, only so this script can sample
  // its growing size from the outside — downloadArchive itself is called unmodified below.
  const temporaryFilePath = join(storageDirectory, `${dateHour}.json.gz.tmp`);
  const stopDownloadSampler = startRssSampler(
    'download',
    () => `bytesReadSoFar=${formatMb(readFileSizeSafely(temporaryFilePath))}`,
  );

  let filePath: string;

  try {
    ({ filePath } = await downloadArchive(dateHour, {
      baseUrl,
      storageDirectory,
      timeoutMs: downloadTimeoutMs,
    }));
  } finally {
    stopDownloadSampler();
  }

  const archiveSizeBytes = readFileSizeSafely(filePath);
  // eslint-disable-next-line no-console -- CLI diagnostic script.
  console.log(`Downloaded ${formatMb(archiveSizeBytes)}. Processing...`);

  const client = new MongoClient(mongoUri);

  await client.connect();

  const collection = client.db().collection<IGithubEventDocument>('events');
  const stopProcessingSampler = startRssSampler(
    'process',
    () => `archiveSize=${formatMb(archiveSizeBytes)}`,
  );

  try {
    const result = await processArchive(filePath, importId, { collection, batchSize });

    // eslint-disable-next-line no-console -- CLI diagnostic script.
    console.log('Done:', result);
  } finally {
    stopProcessingSampler();
    await client.close();
  }
}

await main();
