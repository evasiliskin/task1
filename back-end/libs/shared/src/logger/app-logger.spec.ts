import { Writable } from 'node:stream';

import { pino, type Logger } from 'pino';

import { AppLogger } from './app-logger.js';

function captureLogger(): { root: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });

  return { root: pino({ level: 'trace' }, stream), lines };
}

describe('AppLogger', () => {
  it('should bind source and channel once via a child logger, when the logger is created', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'HealthController', 'http');

    logger.info({ statusCode: 200 }, 'request handled');

    expect(lines[0]).toMatchObject({
      source: 'HealthController',
      channel: 'http',
      statusCode: 200,
      msg: 'request handled',
    });
  });

  it('should serialize the error under the standard err key, when one is supplied', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'rmq');

    logger.error(
      { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      'import failed',
      new Error('disk full'),
    );

    expect(lines[0].err).toMatchObject({ type: 'Error', message: 'disk full' });
    expect(String((lines[0].err as { stack: string }).stack)).toContain('disk full');
  });

  it('should include the cause chain, when the error wraps another', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'rmq');

    logger.error({}, 'failed', new Error('outer', { cause: new Error('inner') }));

    const err = lines[0].err as { message: string; stack: string };

    expect(err.message).toContain('inner');
    expect(err.stack).toContain('caused by: Error: inner');
  });

  it('should redact a sensitive key, when it is nested anywhere in the fields', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'http');

    logger.info({ payload: { nested: { apiKey: 'gha-1' } } }, 'published');

    expect(lines[0].payload).toEqual({ nested: { apiKey: '[REDACTED]' } });
  });

  it('should carry the derived bindings onto every line, when the logger is derived with with()', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'rmq').with({
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });

    logger.info({}, 'stage one');
    logger.info({}, 'stage two');

    expect(lines.map((line) => line.importId)).toEqual([
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ]);
  });

  it('should write at trace, debug and warn level, when those methods are called', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'http');

    logger.trace({}, 'trace line');
    logger.debug({}, 'debug line');
    logger.warn({}, 'warn line');

    expect(lines.map((line) => line.msg)).toEqual(['trace line', 'debug line', 'warn line']);
  });

  it('should serialize the error under the standard err key, when fatal is called with one', () => {
    const { root, lines } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'rmq');

    logger.fatal(
      { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      'unrecoverable',
      new Error('disk full'),
    );

    expect(lines[0]).toMatchObject({
      msg: 'unrecoverable',
      importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
    expect(lines[0].err).toMatchObject({ message: 'disk full' });
  });

  it('should not write a line, when the level is disabled', () => {
    const writeSpy = vi.fn((_chunk: Buffer, _encoding: string, callback: () => void) => {
      callback();
    });
    const stream = new Writable({ write: writeSpy });
    const logger = AppLogger.create(pino({ level: 'error' }, stream), 'Svc', 'http');

    logger.info({}, 'should be skipped');

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('should report the active level, when asked whether debug is enabled', () => {
    const { root } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'http');

    expect(logger.isLevelEnabled('debug')).toBe(true);
    expect(AppLogger.create(pino({ level: 'warn' }), 'Svc', 'http').isLevelEnabled('debug')).toBe(
      false,
    );
  });

  it('should emit each pino binding key exactly once, when a line is logged', () => {
    const rawLines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        rawLines.push(chunk.toString());
        callback();
      },
    });
    const root = pino({ level: 'trace', base: { service: 'service-a' } }, stream);
    const logger = AppLogger.create(root, 'ImportOrchestrationService', 'rmq');

    logger.info({ importSource: 'download', dependency: 'rabbitmq' }, 'import started');

    const line = rawLines[0] ?? '';

    expect(line.match(/"source":/g)).toHaveLength(1);
    expect(line.match(/"service":/g)).toHaveLength(1);
    expect(line.match(/"channel":/g)).toHaveLength(1);
  });

  it('should reject pino binding keys at the type level, when they are passed as log fields', () => {
    const { root } = captureLogger();
    const logger = AppLogger.create(root, 'Svc', 'rmq');

    // @ts-expect-error -- `source` is a child-logger binding; a field of the same name emits a duplicate JSON key.
    logger.info({ source: 'download' }, 'import started');
    // @ts-expect-error -- `service` is a `base` binding; a field of the same name emits a duplicate JSON key.
    logger.info({ service: 'rabbitmq' }, 'health check failed');
    // @ts-expect-error -- `msg` is pino's message key.
    logger.info({ msg: 'shadowed' }, 'shadowed');
  });
});
