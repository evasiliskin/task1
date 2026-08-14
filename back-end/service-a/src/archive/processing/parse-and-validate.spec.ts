import { parseAndValidate } from './parse-and-validate.js';

describe('parseAndValidate', () => {
  // eslint-disable-next-line @typescript-eslint/require-await
  async function* fromLines(lines: string[]): AsyncGenerator<string> {
    for (const line of lines) {
      yield line;
    }
  }

  const validLine = JSON.stringify({
    id: '1',
    type: 'PushEvent',
    created_at: '2026-08-11T00:00:00Z',
    actor: { id: 1, login: 'octocat' },
    repo: { id: 2, name: 'octocat/hello-world' },
    payload: {},
  });

  it('should yield the parsed event and not call onInvalidLine, when the line is valid', async () => {
    const onInvalidLine = vi.fn();
    const results = [];

    for await (const event of parseAndValidate(fromLines([validLine]), onInvalidLine)) {
      results.push(event);
    }

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
    expect(onInvalidLine).not.toHaveBeenCalled();
  });

  it('should call onInvalidLine and yield nothing, when the line is not valid JSON', async () => {
    const onInvalidLine = vi.fn();
    const results = [];

    for await (const event of parseAndValidate(fromLines(['{not valid json']), onInvalidLine)) {
      results.push(event);
    }

    expect(results).toEqual([]);
    expect(onInvalidLine).toHaveBeenCalledWith('{not valid json', expect.any(SyntaxError));
  });

  it('should call onInvalidLine and yield nothing, when the line is valid JSON but fails schema validation', async () => {
    const onInvalidLine = vi.fn();
    const invalidLine = JSON.stringify({ type: 'PushEvent' });
    const results = [];

    for await (const event of parseAndValidate(fromLines([invalidLine]), onInvalidLine)) {
      results.push(event);
    }

    expect(results).toEqual([]);
    expect(onInvalidLine).toHaveBeenCalledWith(invalidLine, expect.anything());
  });

  it('should truncate the sample passed to onInvalidLine to 200 characters, when the line is longer', async () => {
    const onInvalidLine = vi.fn();
    const longInvalidLine = `{"padding":"${'x'.repeat(300)}"`;
    const results = [];

    for await (const event of parseAndValidate(fromLines([longInvalidLine]), onInvalidLine)) {
      results.push(event);
    }

    expect(onInvalidLine).toHaveBeenCalledWith(longInvalidLine.slice(0, 200), expect.anything());
  });

  it('should yield only the valid events in order, when valid and invalid lines are mixed', async () => {
    const onInvalidLine = vi.fn();
    const results = [];

    for await (const event of parseAndValidate(
      fromLines(['not json', validLine, '{"type":"PushEvent"}']),
      onInvalidLine,
    )) {
      results.push(event);
    }

    expect(results).toHaveLength(1);
    expect(onInvalidLine).toHaveBeenCalledTimes(2);
  });

  it('should not throw, when onInvalidLine is omitted and a line is invalid', async () => {
    const results = [];

    for await (const event of parseAndValidate(fromLines(['not json']))) {
      results.push(event);
    }

    expect(results).toEqual([]);
  });
});
