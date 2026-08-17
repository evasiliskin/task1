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

  it('should return the same importId, when the same key is claimed twice in sequence', async () => {
    const idempotencyKey = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    const first = await tracker.claim(idempotencyKey);
    const second = await tracker.claim(idempotencyKey);

    expect(second).toEqual(first);
    await expect(collection.countDocuments({ idempotencyKey })).resolves.toBe(1);
  });

  it('should return one importId, when the same key is claimed concurrently', async () => {
    const idempotencyKey = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    const [first, second, third] = await Promise.all([
      tracker.claim(idempotencyKey),
      tracker.claim(idempotencyKey),
      tracker.claim(idempotencyKey),
    ]);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    await expect(collection.countDocuments({ idempotencyKey })).resolves.toBe(1);
  });

  it('should expose a unique partial index on idempotencyKey, when the indexes are inspected', async () => {
    const indexes = await collection.indexes();
    const idempotencyKeyIndex = indexes.find(
      (index) => index.key !== undefined && 'idempotencyKey' in index.key,
    );

    expect(idempotencyKeyIndex).toMatchObject({
      unique: true,
      partialFilterExpression: { idempotencyKey: { $exists: true } },
    });
  });

  it('should fail with E11000, when two direct inserts share an idempotencyKey', async () => {
    const idempotencyKey = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

    await collection.insertOne({
      importId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      idempotencyKey,
      claimedAt: new Date(),
    } as IImportRunDocument);

    await expect(
      collection.insertOne({
        importId: '9b2b4d1e-6f3a-4c8e-9d2a-8f1e5c7a3b04',
        idempotencyKey,
        claimedAt: new Date(),
      } as IImportRunDocument),
    ).rejects.toMatchObject({ code: 11_000 });
  });

  it('should start the run, when the importId was freshly claimed and never started', async () => {
    const { importId } = await tracker.claim('3f8a1c72-5d94-4b1e-a0f6-2c7d9e4b8a51');
    const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

    await tracker.recordStarted(importId, source, new Date());

    const document = await tracker.findByImportId(importId);

    expect(document).toMatchObject({ importId, status: 'started', source });
  });

  it('should throw ImportAlreadyClaimedError, when recordStarted is redelivered for an already-started importId', async () => {
    const { importId } = await tracker.claim('e2d5a7c4-1b83-4f60-9a2e-7c5b4d1f8a03');
    const source = { type: 'download' as const, archive: '2026-08-11-0.json.gz' };

    await tracker.recordStarted(importId, source, new Date());

    await expect(tracker.recordStarted(importId, source, new Date())).rejects.toBeInstanceOf(
      ImportAlreadyClaimedError,
    );
  });
});
