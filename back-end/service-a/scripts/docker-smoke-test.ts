// back-end/service-a/scripts/docker-smoke-test.ts
import { randomUUID } from 'node:crypto';

import { ClientProxyFactory, type ClientProxy, Transport } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
const SERVICE_A_QUEUE = process.env.RABBITMQ_SERVICE_A_QUEUE ?? 'service_a_queue';
const SERVICE_B_QUEUE = process.env.RABBITMQ_SERVICE_B_QUEUE ?? 'service_b_queue';
const IMPORT_POLL_TIMEOUT_MS = 120_000;
const IMPORT_POLL_INTERVAL_MS = 3_000;
const RPC_TIMEOUT_MS = 60_000;

interface IImportStatus {
  status: string;
}

interface IGenerateReportResult {
  reportPath: string;
}

function makeClient(queue: string): ClientProxy {
  return ClientProxyFactory.create({
    transport: Transport.RMQ,
    options: { urls: [RABBITMQ_URL], queue, queueOptions: { durable: true } },
  });
}

async function waitForImportCompletion(serviceAClient: ClientProxy, importId: string): Promise<void> {
  const deadline = Date.now() + IMPORT_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await firstValueFrom(
      serviceAClient
        .send<IImportStatus | null>('imports.status.get', { importId })
        .pipe(timeout(RPC_TIMEOUT_MS)),
    );

    if (status?.status === 'completed') {
      return;
    }

    if (status?.status === 'failed') {
      throw new Error(`Import ${importId} failed`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, IMPORT_POLL_INTERVAL_MS);
    });
  }

  throw new Error(`Import ${importId} did not complete within ${IMPORT_POLL_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  const dateHour = process.argv[2];

  if (dateHour === undefined) {
    throw new Error(
      'Usage: pnpm --filter service-a run smoke:report <dateHour, e.g. 2026-08-11-0>',
    );
  }

  const serviceAClient = makeClient(SERVICE_A_QUEUE);
  const serviceBClient = makeClient(SERVICE_B_QUEUE);
  const importId = randomUUID();

  try {
    // eslint-disable-next-line no-console -- CLI diagnostic script.
    console.log(`[smoke] triggering download import ${importId} for ${dateHour}...`);

    serviceAClient.emit('archive.import.download', { importId, dateHour }).subscribe({
      // eslint-disable-next-line no-console -- CLI diagnostic script.
      error: (error: unknown) => console.error('[smoke] emit error', error),
    });

    await waitForImportCompletion(serviceAClient, importId);

    // eslint-disable-next-line no-console -- CLI diagnostic script.
    console.log('[smoke] import completed, requesting PDF report...');

    const report = await firstValueFrom(
      serviceBClient
        .send<IGenerateReportResult>('reports.pdf.generate', {})
        .pipe(timeout(RPC_TIMEOUT_MS)),
    );

    if (typeof report.reportPath !== 'string' || report.reportPath.length === 0) {
      throw new Error(`reports.pdf.generate returned an invalid reportPath: ${String(report.reportPath)}`);
    }

    // eslint-disable-next-line no-console -- CLI diagnostic script.
    console.log(`[smoke] PDF report generated at ${report.reportPath} inside the service-b container. PASS.`);
  } finally {
    await serviceAClient.close();
    await serviceBClient.close();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console -- CLI diagnostic script.
    console.error('[smoke] FAIL:', error);
    process.exit(1);
  });
