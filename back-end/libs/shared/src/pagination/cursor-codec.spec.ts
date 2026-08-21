import { z } from 'zod';

import { decodeCursor, encodeCursor } from './cursor-codec.js';

const payloadSchema = z.object({ id: z.string() });

describe('cursor codec', () => {
  it('should return the original payload, when an encoded cursor is decoded', () => {
    const encoded = encodeCursor({ id: 'abc' });

    expect(decodeCursor(encoded, payloadSchema)).toEqual({ id: 'abc' });
  });

  it('should return null, when the cursor is not valid base64url JSON', () => {
    expect(decodeCursor('!!!not-base64!!!', payloadSchema)).toBeNull();
  });

  it('should return null, when a well-formed cursor payload fails the schema', () => {
    expect(decodeCursor(encodeCursor({ wrong: 1 }), payloadSchema)).toBeNull();
  });
});
