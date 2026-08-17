import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';

import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { ImportRunInProgressError } from './import-run-in-progress.error.js';
import { type ISettleImportOptions, settleImportResult } from './import-settlement.js';
import { ImportShuttingDownError } from './import-shutdown.error.js';

function buildOptions(overrides: Partial<ISettleImportOptions> = {}): ISettleImportOptions {
  return {
    run: vi.fn().mockResolvedValue(undefined),
    channel: {
      ack: vi.fn(),
      nack: vi.fn(),
      sendToQueue: vi.fn(),
      assertQueue: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    message: {
      content: Buffer.from('{}'),
      properties: { headers: {} },
      fields: { redelivered: false },
    },
    retryPublisher: {
      settleFailure: vi.fn().mockResolvedValue('retried'),
    } as unknown as RetryPublisher,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
    importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ...overrides,
  };
}

describe('settleImportResult', () => {
  it('should ack the message, when the import succeeds', async () => {
    const options = buildOptions();

    await settleImportResult(options);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.channel.ack).toHaveBeenCalledWith(options.message);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.retryPublisher.settleFailure).not.toHaveBeenCalled();
  });

  it('should run the import as a fresh delivery, when the message carries no retry header and is a first delivery', async () => {
    const options = buildOptions();

    await settleImportResult(options);

    expect(options.run).toHaveBeenCalledWith('fresh');
  });

  it('should run the import as a retry, when the message carries x-retry-count', async () => {
    const options = buildOptions({
      message: {
        content: Buffer.from('{}'),
        properties: { headers: { 'x-retry-count': 2 } },
        fields: { redelivered: false },
      },
    });

    await settleImportResult(options);

    expect(options.run).toHaveBeenCalledWith('retry');
  });

  it('should run the import as a redelivery, when the broker redelivered an unacked message', async () => {
    const options = buildOptions({
      message: {
        content: Buffer.from('{}'),
        properties: { headers: {} },
        fields: { redelivered: true },
      },
    });

    await settleImportResult(options);

    expect(options.run).toHaveBeenCalledWith('redelivery');
  });

  it('should requeue without acking or retrying, when the service is shutting down', async () => {
    const options = buildOptions({ run: vi.fn().mockRejectedValue(new ImportShuttingDownError()) });

    await settleImportResult(options);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.channel.nack).toHaveBeenCalledWith(options.message, false, true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.channel.ack).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.retryPublisher.settleFailure).not.toHaveBeenCalled();
  });

  it('should delegate to RetryPublisher, when the run is still held by another consumer', async () => {
    const inProgress = new ImportRunInProgressError('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    const options = buildOptions({ run: vi.fn().mockRejectedValue(inProgress) });

    await settleImportResult(options);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.channel.ack).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.retryPublisher.settleFailure).toHaveBeenCalledWith(
      options.channel,
      options.message,
      inProgress,
    );
  });

  it('should ack without retrying, when the import was already claimed', async () => {
    const options = buildOptions({
      run: vi
        .fn()
        .mockRejectedValue(new ImportAlreadyClaimedError('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')),
    });

    await settleImportResult(options);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.channel.ack).toHaveBeenCalledWith(options.message);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.retryPublisher.settleFailure).not.toHaveBeenCalled();
  });

  it('should delegate to RetryPublisher without acking, when the import fails for any other reason', async () => {
    const failure = new Error('mongo down');
    const options = buildOptions({ run: vi.fn().mockRejectedValue(failure) });

    await settleImportResult(options);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.channel.ack).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referencing the mocked method for assertion only, never calling it unbound.
    expect(options.retryPublisher.settleFailure).toHaveBeenCalledWith(
      options.channel,
      options.message,
      failure,
    );
  });
});
