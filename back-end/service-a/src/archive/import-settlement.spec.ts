import { type AppLogger } from '@task1/shared/logger/app-logger';
import { type RetryPublisher } from '@task1/shared/messaging/retry-publisher';

import { ImportAlreadyClaimedError } from './import-claim.error.js';
import { type ISettleImportOptions, settleImportResult } from './import-settlement.js';

function buildOptions(overrides: Partial<ISettleImportOptions> = {}): ISettleImportOptions {
  return {
    run: vi.fn().mockResolvedValue(undefined),
    channel: { ack: vi.fn(), nack: vi.fn(), sendToQueue: vi.fn(), assertQueue: vi.fn() },
    message: { content: Buffer.from('{}'), properties: {} },
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
