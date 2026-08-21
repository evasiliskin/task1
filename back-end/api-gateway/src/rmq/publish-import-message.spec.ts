import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { NEVER, of, throwError, TimeoutError } from 'rxjs';

import { publishImportMessage } from './publish-import-message.js';

const PATTERN = 'archive.import.download';
const PAYLOAD = { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' };

describe('publishImportMessage', () => {
  it('should resolve, when the broker accepts the publish', async () => {
    const propagatingClient = { emit: vi.fn().mockReturnValue(of(undefined)) };

    await expect(
      publishImportMessage({
        propagatingClient: propagatingClient as never,
        client: {} as never,
        pattern: PATTERN,
        payload: PAYLOAD,
        timeoutMs: 1000,
      }),
    ).resolves.toBeUndefined();
  });

  it('should throw MessagePublishFailedError, when the publish fails', async () => {
    const propagatingClient = {
      emit: vi.fn().mockReturnValue(throwError(() => new Error('broker down'))),
    };

    await expect(
      publishImportMessage({
        propagatingClient: propagatingClient as never,
        client: {} as never,
        pattern: PATTERN,
        payload: PAYLOAD,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(MessagePublishFailedError);
  });

  it('should throw TimeoutError, when the broker never confirms the publish', async () => {
    const propagatingClient = { emit: vi.fn().mockReturnValue(NEVER) };

    await expect(
      publishImportMessage({
        propagatingClient: propagatingClient as never,
        client: {} as never,
        pattern: PATTERN,
        payload: PAYLOAD,
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
