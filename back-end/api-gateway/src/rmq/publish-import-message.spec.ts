import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { of, throwError } from 'rxjs';

import { publishImportMessage } from './publish-import-message.js';

describe('publishImportMessage', () => {
  it('should resolve, when the broker accepts the publish', async () => {
    const propagatingClient = { emit: vi.fn().mockReturnValue(of(undefined)) };

    await expect(
      publishImportMessage({
        propagatingClient: propagatingClient as never,
        client: {} as never,
        pattern: 'archive.import.download',
        payload: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
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
        pattern: 'archive.import.download',
        payload: { importId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      }),
    ).rejects.toBeInstanceOf(MessagePublishFailedError);
  });
});
