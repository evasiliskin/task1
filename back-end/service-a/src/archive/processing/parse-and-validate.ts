import { rawGithubEventSchema, type RawGithubEvent } from './raw-github-event.schema.js';

const INVALID_LINE_SAMPLE_LENGTH = 200;

export type OnInvalidLine = (rawLine: string, error: unknown) => void;

export async function* parseAndValidate(
  lines: AsyncIterable<string>,
  onInvalidLine?: OnInvalidLine,
): AsyncGenerator<RawGithubEvent> {
  for await (const line of lines) {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(line);
    } catch (error) {
      onInvalidLine?.(line.slice(0, INVALID_LINE_SAMPLE_LENGTH), error);

      continue;
    }

    const result = rawGithubEventSchema.safeParse(parsedJson);

    if (!result.success) {
      onInvalidLine?.(line.slice(0, INVALID_LINE_SAMPLE_LENGTH), result.error);

      continue;
    }

    yield result.data;
  }
}
