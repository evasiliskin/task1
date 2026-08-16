import { randomUUID } from 'node:crypto';

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient, type Collection } from 'mongodb';

import { ensureImportIndexes } from '../../src/archive/ensure-import-indexes.js';
import { ImportAlreadyClaimedError } from '../../src/archive/import-claim.error.js';
import { ImportRunTracker } from '../../src/archive/import-run-tracker.service.js';
import { type IImportRunDocument } from '../../src/archive/import-run.types.js';

describe('import claim/start against real MongoDB', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let collection: Collection<IImportRunDocument>;
  let tracker: ImportRunTracker;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    collection = client.db('service_a_int').collection<IImportRunDocument>('imports');
    await ensureImportIndexes(collection);
    tracker = new ImportRunTracker(collection);
  });

  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  beforeEach(async () => {
    await collection.deleteMany({});
  });

  it('should converge two claims of the same key on the same importId', async () => {
    const idempotencyKey = randomUUID();

    const first = await tracker.claim(idempotencyKey);
    const second = await tracker.claim(idempotencyKey);

    expect(second).toEqual(first);
    await expect(collection.countDocuments({ idempotencyKey })).resolves.toBe(1);
  });

  it('should converge concurrent claims of the same key on one importId', async () => {
    const idempotencyKey = randomUUID();

    const [first, second, third] = await Promise.all([
      tracker.claim(idempotencyKey),
      tracker.claim(idempotencyKey),
      tracker.claim(idempotencyKey),
    ]);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    await expect(collection.countDocuments({ idempotencyKey })).resolves.toBe(1);
  });

  it('should enforce a unique, partial index on idempotencyKey', async () => {
    const indexes = await collection.indexes();
    const idempotencyKeyIndex = indexes.find(
      (index) => index.key !== undefined && 'idempotencyKey' in index.key,
    );

    expect(idempotencyKeyIndex).toMatchObject({
      unique: true,
      partialFilterExpression: { idempotencyKey: { $exists: true } },
    });
  });

  it('should reject two direct inserts sharing an idempotencyKey with E11000', async () => {
    const idempotencyKey = randomUUID();

    await collection.insertOne({
      importId: randomUUID(),
      idempotencyKey,
      claimedAt: new Date(),
    } as IImportRunDocument);

    await expect(
      collection.insertOne({
        importId: randomUUID(),
        idempotencyKey,
        claimedAt: new Date(),
      } as IImportRunDocument),
    ).rejects.toMatchObject({ code: 11_000 });
  });

  it('should start a freshly-claimed, unstarted importId', async () => {
    const { importId } = await tracker.claim(randomUUID());
    const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

    await tracker.recordStarted(importId, source, new Date());

    const document = await tracker.findByImportId(importId);

    expect(document).toMatchObject({ importId, status: 'started', source });
  });

  it('should throw ImportAlreadyClaimedError, when recordStarted is redelivered for an already-started importId', async () => {
    const { importId } = await tracker.claim(randomUUID());
    const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

    await tracker.recordStarted(importId, source, new Date());

    await expect(tracker.recordStarted(importId, source, new Date())).rejects.toBeInstanceOf(
      ImportAlreadyClaimedError,
    );
  });
});
