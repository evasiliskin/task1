import { MessagePublishFailedError } from '@task1/shared/errors/index';
import { of, throwError } from 'rxjs';

import { publishImportMessage } from './publish-import-message.js';

describe('publishImportMessage', () => {
  it('should resolve once the broker accepts the publish', async () => {
    const propagatingClient = { emit: vi.fn().mockReturnValue(of(undefined)) };

    await expect(
      publishImportMessage({
        propagatingClient: propagatingClient as never,
        client: {} as never,
        pattern: 'archive.import.download',
        payload: { importId: 'a' },
      }),
    ).resolves.toBeUndefined();
  });

  it('should raise MessagePublishFailedError when the publish fails', async () => {
    const propagatingClient = {
      emit: vi.fn().mockReturnValue(throwError(() => new Error('broker down'))),
    };

    await expect(
      publishImportMessage({
        propagatingClient: propagatingClient as never,
        client: {} as never,
        pattern: 'archive.import.download',
        payload: { importId: 'a' },
      }),
    ).rejects.toBeInstanceOf(MessagePublishFailedError);
  });
});
