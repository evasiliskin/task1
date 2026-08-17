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

  it('should reject the archive and write nothing, when it is a gzip bomb', async () => {
    const path = writeGzipFixture('0'.repeat(40 * MEGABYTE));
    const heapBefore = process.memoryUsage().heapUsed;

    await expect(
      processArchive(path, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', {
        ...baseOptions(),
        maxDecompressedBytes: MEGABYTE,
      }),
    ).rejects.toBeInstanceOf(ArchiveTooLargeError);

    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(50 * MEGABYTE);
    await expect(collection.countDocuments({})).resolves.toBe(0);
  });

  it('should reject the archive before buffering it whole, when it contains no newline', async () => {
    const path = writeGzipFixture('x'.repeat(5 * MEGABYTE));

    await expect(
      processArchive(path, 'f47ac10b-58cc-4372-a567-0e02b2c3d479', {
        ...baseOptions(),
        maxLineBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(LineTooLongError);
  });

  it('should store actor and repo names byte-exactly, when non-ASCII names span chunk boundaries', async () => {
    const login = 'jöhänn-🎉-测试';
    const repoName = 'орг/репозиторий-✅';
    const padding = 'p'.repeat(70_000);
    const lines = [
      buildEvent('e1', login, repoName),
      buildEvent('pad', padding, 'pad/pad'),
      buildEvent('e2', login, repoName),
    ];

    const result = await processArchive(
      writeGzipFixture(`${lines.join('\n')}\n`),
      '7c9e6679-7425-40de-944b-e07fc1f90ae7',
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

  it('should produce identical counters, when the same archive is ingested at concurrency 1 and 3', async () => {
    const lines = Array.from({ length: 250 }, (_, index) =>
      buildEvent(`seq-${index}`, 'octocat', 'octocat/hello-world'),
    );
    const path = writeGzipFixture(`${lines.join('\n')}\n`);

    const sequential = await processArchive(path, '9b2b4d1e-6f3a-4c8e-9d2a-8f1e5c7a3b04', {
      ...baseOptions(),
      insertConcurrency: 1,
    });

    await collection.deleteMany({});

    const concurrent = await processArchive(path, 'c56a4180-65aa-42ec-a945-5fd21dec0538', {
      ...baseOptions(),
      insertConcurrency: 3,
    });

    expect(concurrent).toEqual(sequential);
    expect(sequential.validEvents).toBe(250);
  });

  it('should store the payload in the documented shape, when the event is a PushEvent', async () => {
    const pushEvent = JSON.stringify({
      id: 'push-1',
      type: 'PushEvent',
      created_at: '2026-08-11T00:00:00Z',
      actor: { id: 1, login: 'octocat' },
      repo: { id: 2, name: 'octocat/hello-world' },
      payload: { ref: 'refs/heads/main', commits: [{ sha: 'a' }, { sha: 'b' }], extra: 'dropped' },
    });

    await processArchive(
      writeGzipFixture(`${pushEvent}\n`),
      '3f8a1c72-5d94-4b1e-a0f6-2c7d9e4b8a51',
      baseOptions(),
    );

    const stored = await collection.findOne({ eventId: 'push-1' } as never);

    expect((stored as unknown as { payload: unknown }).payload).toEqual({
      ref: 'refs/heads/main',
      commitCount: 2,
    });
  });
});
