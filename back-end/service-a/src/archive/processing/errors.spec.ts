import { ErrorCategory } from '@task1/shared/errors/index';

import { ArchiveProcessingError, ArchiveTooLargeError, LineTooLongError } from './errors.js';

describe('ArchiveProcessingError', () => {
  it('should be an external error carrying the import id and file path', () => {
    const cause = new Error('socket hang up');
    const error = new ArchiveProcessingError('boom', 'import-1', '/data/a.json.gz', cause);

    expect(error.code).toBe('ARCHIVE_PROCESSING_FAILED');
    expect(error.category).toBe(ErrorCategory.EXTERNAL);
    expect(error.params).toEqual({ importId: 'import-1', filePath: '/data/a.json.gz' });
    expect(error.cause).toBe(cause);
  });
});

describe('ArchiveTooLargeError', () => {
  it('should be a validation error carrying the exceeded limit', () => {
    const error = new ArchiveTooLargeError(1024);

    expect(error.code).toBe('ARCHIVE_TOO_LARGE');
    expect(error.category).toBe(ErrorCategory.VALIDATION);
    expect(error.params).toEqual({ maxDecompressedBytes: 1024 });
  });

  it('should name the limit in its message', () => {
    expect(new ArchiveTooLargeError(1024).message).toContain('1024');
  });
});

describe('LineTooLongError', () => {
  it('should be a validation error carrying the exceeded limit', () => {
    const error = new LineTooLongError(64);

    expect(error.code).toBe('ARCHIVE_LINE_TOO_LONG');
    expect(error.category).toBe(ErrorCategory.VALIDATION);
    expect(error.params).toEqual({ maxLineBytes: 64 });
  });
});
