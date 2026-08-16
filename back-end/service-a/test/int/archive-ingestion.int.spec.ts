import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';

import { ensureEventIndexes } from '../../src/archive/processing/ensure-event-indexes.js';
import { ArchiveTooLargeError, LineTooLongError } from '../../src/archive/processing/errors.js';
import { processArchive } from '../../src/archive/processing/process-archive.js';

const MEGABYTE = 1_048_576;

function writeGzipFixture(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'archive-int-'));
  const path = join(directory, 'fixture.json.gz');

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from a per-test mkdtemp() sandbox directory, not external input.
  writeFileSync(path, gzipSync(Buffer.from(contents, 'utf8')));

  return path;
}

function buildEvent(id: string, login: string, repoName: string): string {
  return JSON.stringify({
    id,
    type: 'WatchEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login },
    repo: { id: 2, name: repoName },
    payload: {},
  });
}

describe('archive ingestion against real MongoDB', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let collection: Collection<never>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    collection = client.db('service_a_int').collection('events') as never;
    await ensureEventIndexes(collection as never);
  });

  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  beforeEach(async () => {
    await collection.deleteMany({});
  });

  const baseOptions = () => ({
    collection: collection as never,
    batchSize: 100,
    maxDecompressedBytes: 10 * MEGABYTE,
    maxLineBytes: MEGABYTE,
    insertConcurrency: 2,
  });

  it('should reject a gzip bomb without exhausting memory or writing anything', async () => {
    // 40 MB of zeros compresses to a few KB; the budget here is 1 MB.
    const path = writeGzipFixture('0'.repeat(40 * MEGABYTE));
    const heapBefore = process.memoryUsage().heapUsed;

    await expect(
      processArchive(path, 'import-bomb', {
        ...baseOptions(),
        maxDecompressedBytes: MEGABYTE,
      }),
    ).rejects.toBeInstanceOf(ArchiveTooLargeError);

    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(50 * MEGABYTE);
    await expect(collection.countDocuments({})).resolves.toBe(0);
  });

  it('should reject a newline-free archive before buffering it whole', async () => {
    const path = writeGzipFixture('x'.repeat(5 * MEGABYTE));

    await expect(
      processArchive(path, 'import-noline', { ...baseOptions(), maxLineBytes: 1024 }),
    ).rejects.toBeInstanceOf(LineTooLongError);
  });

  it('should store non-ASCII actor and repo names byte-exactly across chunk boundaries', async () => {
    const login = 'jöhänn-🎉-测试';
    const repoName = 'орг/репозиторий-✅';
    // The padding event forces the following event across a 64 KB read boundary, so multi-byte
    // sequences land mid-chunk — the exact condition that produced replacement characters.
    const padding = 'p'.repeat(70_000);
    const lines = [
      buildEvent('e1', login, repoName),
      buildEvent('pad', padding, 'pad/pad'),
      buildEvent('e2', login, repoName),
    ];

    const result = await processArchive(
      writeGzipFixture(`${lines.join('\n')}\n`),
      'import-utf8',
      baseOptions(),
    );

    expect(result.validEvents).toBe(3);

    const stored = await collection.find({ eventId: { $in: ['e1', 'e2'] } } as never).toArray();

    expect(stored).toHaveLength(2);

    for (const document of stored) {
      const typed = document as unknown as { actor: { login: string }; repo: { name: string } };

      expect(typed.actor.login).toBe(login);
      expect(typed.repo.name).toBe(repoName);
    }
  });

  it('should produce identical counters at concurrency 1 and 3', async () => {
    const lines = Array.from({ length: 250 }, (_, index) =>
      buildEvent(`seq-${index}`, 'octocat', 'octocat/hello-world'),
    );
    const path = writeGzipFixture(`${lines.join('\n')}\n`);

    const sequential = await processArchive(path, 'import-seq', {
      ...baseOptions(),
      insertConcurrency: 1,
    });

    await collection.deleteMany({});

    const concurrent = await processArchive(path, 'import-conc', {
      ...baseOptions(),
      insertConcurrency: 3,
    });

    expect(concurrent).toEqual(sequential);
    expect(sequential.validEvents).toBe(250);
  });

  it('should store a PushEvent payload identically to the pre-change shape', async () => {
    const pushEvent = JSON.stringify({
      id: 'push-1',
      type: 'PushEvent',
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: { ref: 'refs/heads/main', commits: [{ sha: 'a' }, { sha: 'b' }], extra: 'dropped' },
    });

    await processArchive(writeGzipFixture(`${pushEvent}\n`), 'import-push', baseOptions());

    const stored = await collection.findOne({ eventId: 'push-1' } as never);

    // Exactly the two fields buildPayload keeps — `extra` must not survive.
    expect((stored as unknown as { payload: unknown }).payload).toEqual({
      ref: 'refs/heads/main',
      commitCount: 2,
    });
  });
});
