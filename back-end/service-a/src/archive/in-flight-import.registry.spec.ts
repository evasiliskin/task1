import { InFlightImportRegistry } from './in-flight-import.registry.js';

describe('InFlightImportRegistry', () => {
  it('should return the tracked operation result', async () => {
    const registry = new InFlightImportRegistry();

    await expect(registry.track(() => Promise.resolve('done'))).resolves.toBe('done');
  });

  it('should propagate a tracked failure and still release the slot', async () => {
    const registry = new InFlightImportRegistry();

    await expect(registry.track(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(registry.size).toBe(0);
  });

  it('should report the number of operations in flight', async () => {
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

  it('should drain immediately when nothing is in flight', async () => {
    await expect(new InFlightImportRegistry().drain(50)).resolves.toBe(true);
  });

  it('should drain once the in-flight operations settle', async () => {
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

  it('should give up after the timeout', async () => {
    const registry = new InFlightImportRegistry();

    registry.track(() => new Promise(() => undefined)).catch(() => undefined);

    await expect(registry.drain(20)).resolves.toBe(false);
  });
});
