import { InFlightImportRegistry } from './in-flight-import.registry.js';

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
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tracked = registry.track(() => gate);

    expect(registry.size).toBe(1);

    release();
    await tracked;

    expect(registry.size).toBe(0);
  });

  it('should drain immediately, when nothing is in flight', async () => {
    await expect(new InFlightImportRegistry().drain(50)).resolves.toBe(true);
  });

  it('should drain, when the in-flight operations settle', async () => {
    const registry = new InFlightImportRegistry();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    registry.track(() => gate).catch(() => undefined);

    const draining = registry.drain(5000);

    release();

    await expect(draining).resolves.toBe(true);
  });

  it('should wait for operations started during the drain, when the consumer keeps delivering', async () => {
    const registry = new InFlightImportRegistry();
    let releaseFirst = (): void => undefined;
    let releaseSecond = (): void => undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    registry.track(() => first).catch(() => undefined);

    const draining = registry.drain(5000);

    registry.track(() => second).catch(() => undefined);
    releaseFirst();

    await new Promise((resolve) => setImmediate(resolve));

    expect(registry.size).toBe(1);

    releaseSecond();

    await expect(draining).resolves.toBe(true);
    expect(registry.size).toBe(0);
  });

  it('should give up, when the drain timeout elapses', async () => {
    const registry = new InFlightImportRegistry();

    registry.track(() => new Promise(() => undefined)).catch(() => undefined);

    await expect(registry.drain(20)).resolves.toBe(false);
  });
});
