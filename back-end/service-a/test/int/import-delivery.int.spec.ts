import {
  buildBothListeners,
  buildImportListener,
  queueDepth,
  sendRpc,
  startRabbitMq,
  type IRabbitMqHarness,
} from './rabbitmq.harness.js';

const IMPORTS_QUEUE = 'service_a_imports_queue';
const DLQ = `${IMPORTS_QUEUE}.dlq`;
const RETRY_QUEUE = `${IMPORTS_QUEUE}.retry`;

describe('import message delivery', () => {
  let harness: IRabbitMqHarness;

  beforeAll(async () => {
    harness = await startRabbitMq();
  });

  afterAll(async () => {
    await harness.stop();
  });

  it('should redeliver an import whose handler failed rather than dropping it', async () => {
    // Boot service-a's import listener with an orchestration service that always fails.
    const app = await buildImportListener(harness.url, {
      importDownload: vi.fn().mockRejectedValue(new Error('mongo down')),
    });

    harness.channel.sendToQueue(
      IMPORTS_QUEUE,
      Buffer.from(
        JSON.stringify({
          pattern: 'archive.import.download',
          data: { importId: '11111111-1111-4111-8111-111111111111', dateHour: '2024-01-01-0' },
        }),
      ),
    );

    await vi.waitFor(
      async () => {
        expect(await queueDepth(harness.channel, RETRY_QUEUE)).toBe(1);
      },
      { timeout: 30_000 },
    );

    await app.close();
  });

  it('should dead-letter an import once retries are exhausted', async () => {
    const app = await buildImportListener(harness.url, {
      importDownload: vi.fn().mockRejectedValue(new Error('still down')),
    });

    harness.channel.sendToQueue(
      IMPORTS_QUEUE,
      Buffer.from(
        JSON.stringify({
          pattern: 'archive.import.download',
          data: { importId: '22222222-2222-4222-8222-222222222222', dateHour: '2024-01-01-0' },
        }),
      ),
      { headers: { 'x-retry-count': 5 } },
    );

    await vi.waitFor(
      async () => {
        expect(await queueDepth(harness.channel, DLQ)).toBe(1);
      },
      { timeout: 30_000 },
    );

    await app.close();
  });

  it('should keep answering RPCs while the import queue is saturated', async () => {
    let releaseImports: () => void;
    const stalledImports = new Promise<void>((resolve) => {
      releaseImports = resolve;
    });
    const app = await buildBothListeners(harness.url, {
      importDownload: vi.fn().mockReturnValue(stalledImports),
    });

    for (let index = 0; index < 4; index += 1) {
      harness.channel.sendToQueue(
        IMPORTS_QUEUE,
        Buffer.from(
          JSON.stringify({
            pattern: 'archive.import.download',
            data: {
              importId: `3333333${index}-3333-4333-8333-333333333333`,
              dateHour: '2024-01-01-0',
            },
          }),
        ),
      );
    }

    const startedAt = Date.now();
    const reply = await sendRpc(harness.channel, 'service_a_queue', 'events.search', { limit: 1 });

    expect(reply).toBeDefined();
    expect(Date.now() - startedAt).toBeLessThan(5000);

    releaseImports!();

    await vi.waitFor(
      async () => {
        expect(await queueDepth(harness.channel, IMPORTS_QUEUE)).toBe(0);
      },
      { timeout: 30_000 },
    );

    await app.close();
  });
});
