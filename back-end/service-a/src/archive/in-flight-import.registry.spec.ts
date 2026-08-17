import { ImportShuttingDownError } from './import-shutdown.error.js';
import { InFlightImportRegistry } from './in-flight-import.registry.js';

function buildGate(): { gate: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { gate, release };
}

function settleAfter(promise: Promise<boolean>, delayMs: number): Promise<'settled' | 'pending'> {
  return Promise.race([
    promise.then(() => 'settled' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), delayMs)),
  ]);
}

describe('InFlightImportRegistry', () => {
  it('should return the operation result, when the tracked operation resolves', async () => {
    const registry = new InFlightImportRegistry();

    await expect(registry.track(() => Promise.resolve('done'))).resolves.toBe('done');
  });

  it('should propagate the failure and release the slot, when the tracked operation rejects', async () => {
    const registry = new InFlightImportRegistry();

    await expect(registry.track(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(registry.size).toBe(0);
  });

  it('should report the number of operations in flight, when operations are tracked', async () => {
    const registry = new InFlightImportRegistry();
    const { gate, release } = buildGate();

    const tracked = registry.track(() => gate);

    expect(registry.size).toBe(1);

    release();
    await tracked;

    expect(registry.size).toBe(0);
  });

  it('should refuse the operation without running it, when shutdown has begun', async () => {
    const registry = new InFlightImportRegistry();
    const operation = vi.fn().mockResolvedValue('done');

    registry.beginShutdown();

    await expect(registry.track(operation)).rejects.toBeInstanceOf(ImportShuttingDownError);
    expect(operation).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('should report that it is shutting down, when shutdown has begun', () => {
    const registry = new InFlightImportRegistry();

    expect(registry.isShuttingDown).toBe(false);

    registry.beginShutdown();

    expect(registry.isShuttingDown).toBe(true);
  });

  it('should drain immediately, when nothing is in flight', async () => {
    await expect(new InFlightImportRegistry().drain(50)).resolves.toBe(true);
  });

  it('should drain, when the in-flight operations settle', async () => {
    const registry = new InFlightImportRegistry();
    const { gate, release } = buildGate();

    registry.track(() => gate).catch(() => undefined);

    const draining = registry.drain(5000);

    release();

    await expect(draining).resolves.toBe(true);
  });

  it('should stay pending until the later operation settles, when work is admitted during the drain', async () => {
    const registry = new InFlightImportRegistry();
    const first = buildGate();
    const second = buildGate();

    registry.track(() => first.gate).catch(() => undefined);

    const draining = registry.drain(5000);

    registry.track(() => second.gate).catch(() => undefined);
    first.release();

    await expect(settleAfter(draining, 50)).resolves.toBe('pending');
    expect(registry.size).toBe(1);

    second.release();

    await expect(draining).resolves.toBe(true);
    expect(registry.size).toBe(0);
  });

  it('should give up, when the drain timeout elapses', async () => {
    const registry = new InFlightImportRegistry();

    registry.track(() => new Promise(() => undefined)).catch(() => undefined);

    await expect(registry.drain(20)).resolves.toBe(false);
  });

  it('should give up, when the timeout elapses while work admitted during the drain is still running', async () => {
    const registry = new InFlightImportRegistry();
    const first = buildGate();

    registry.track(() => first.gate).catch(() => undefined);

    const draining = registry.drain(60);

    registry.track(() => new Promise(() => undefined)).catch(() => undefined);
    first.release();

    await expect(draining).resolves.toBe(false);
  });
});
