export async function* splitLines(source: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let remainder = '';

  for await (const chunk of source) {
    remainder += chunk.toString('utf8');

    let newlineIndex = remainder.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = remainder.slice(0, newlineIndex).replace(/\r$/, '');
      remainder = remainder.slice(newlineIndex + 1);

      if (line.length > 0) {
        yield line;
      }

      newlineIndex = remainder.indexOf('\n');
    }
  }

  const finalLine = remainder.replace(/\r$/, '');

  if (finalLine.length > 0) {
    yield finalLine;
  }
}
