import { ErrorCategory } from '../errors/error-category.enum.js';
import { InternalError } from '../errors/internal/internal-error.js';

import { serializeError } from './error.serializer.js';

class TestError extends InternalError {
  public constructor(message: string, cause?: unknown) {
    super(message, {
      code: 'TEST_FAILURE',
      category: ErrorCategory.INTERNAL,
      params: { importId: 'i-1' },
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

class NoParamsError extends InternalError {
  public constructor(message: string) {
    super(message, { code: 'NO_PARAMS_FAILURE', category: ErrorCategory.INTERNAL });
  }
}

describe('serializeError', () => {
  it('should include type, message and stack, when given a plain Error', () => {
    const serialized = serializeError(new Error('boom')) as Record<string, unknown>;

    expect(serialized.type).toBe('Error');
    expect(serialized.message).toBe('boom');
    expect(serialized.stack).toContain('boom');
  });

  it('should include the AppError taxonomy, when given an AppError', () => {
    const serialized = serializeError(new TestError('failed')) as Record<string, unknown>;

    expect(serialized).toMatchObject({
      code: 'TEST_FAILURE',
      category: ErrorCategory.INTERNAL,
      params: { importId: 'i-1' },
    });
  });

  it('should walk the cause chain, when the error wraps another', () => {
    const serialized = serializeError(new TestError('outer', new Error('inner'))) as {
      cause: { message: string };
    };

    expect(serialized.cause.message).toBe('inner');
  });

  it('should not re-fold a middle cause message, when the chain is 3 levels deep', () => {
    const leaf = new Error('leaf-message');
    const middle = new Error('middle-message', { cause: leaf });
    const outer = new TestError('outer-message', middle);

    const serialized = serializeError(outer) as {
      message: string;
      stack: string;
      cause: { message: string; stack: string; cause: { message: string } };
    };

    // The top-level `message`/`stack` come from pino's `stdSerializers.err()`, which folds the
    // whole downstream chain into one human-readable string — leaf-message legitimately shows up
    // here, once, for a human reading the single top-level string.
    expect(serialized.message).toBe('outer-message: middle-message: leaf-message');
    expect(serialized.stack).toContain('leaf-message');

    // The nested `cause` level (middle) must carry ITS OWN message/stack only — not re-folded
    // with leaf-message baked in a second time. Before the fix, `stdSerializers.err(middle)` was
    // called here too, producing `cause.message === 'middle-message: leaf-message'` and
    // `cause.stack` containing 'caused by: ' + leaf's stack a second time.
    expect(serialized.cause.message).toBe('middle-message');
    expect(serialized.cause.stack).not.toContain('leaf-message');

    // The leaf's own info is still reachable via further nesting, just not duplicated.
    expect(serialized.cause.cause.message).toBe('leaf-message');
  });

  it('should omit params and path, when the AppError carries neither', () => {
    const serialized = serializeError(new NoParamsError('failed')) as Record<string, unknown>;

    expect(serialized).toMatchObject({
      code: 'NO_PARAMS_FAILURE',
      category: ErrorCategory.INTERNAL,
    });
    expect(serialized.params).toBeUndefined();
    expect(serialized.path).toBeUndefined();
  });

  it('should stop at the depth cap, when the cause chain is pathological', () => {
    let error = new Error('root');

    for (let index = 0; index < 10; index += 1) {
      error = new Error(`level-${index}`, { cause: error });
    }

    const json = JSON.stringify(serializeError(error));

    expect(json).toContain('[MaxCauseDepthExceeded]');
  });

  it('should stringify the value, when given a non-Error', () => {
    expect(serializeError('plain string')).toEqual({ message: 'plain string' });
  });
});
