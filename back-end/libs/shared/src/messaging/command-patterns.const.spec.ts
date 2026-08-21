import { COMMAND_PATTERNS } from './command-patterns.const.js';

describe('COMMAND_PATTERNS', () => {
  it('should expose the exact wire strings, when the pattern constants are read', () => {
    expect(COMMAND_PATTERNS).toEqual({
      ARCHIVE_IMPORT_DOWNLOAD: 'archive.import.download',
      ARCHIVE_PROCESS_UPLOAD: 'archive.process.upload',
    });
  });
});
