import {
  buildArchiveFilename,
  buildDownloadTemporaryFilename,
  buildUploadTemporaryFilename,
  isDownloadTemporaryFile,
  isFinalArchiveFile,
  isUploadTemporaryFile,
  parseImportIdFromUploadTemporaryFilename,
} from './archive-paths.js';

const IMPORT_ID = '11111111-1111-4111-8111-111111111111';

describe('archive filename contract', () => {
  it('should build a distinct temp name per producer', () => {
    expect(buildUploadTemporaryFilename(IMPORT_ID)).toBe(`${IMPORT_ID}.upload.tmp`);
    expect(buildDownloadTemporaryFilename(IMPORT_ID)).toBe(`${IMPORT_ID}.download.tmp`);
  });

  it('should build the final archive name', () => {
    expect(buildArchiveFilename(IMPORT_ID)).toBe(`${IMPORT_ID}.json.gz`);
  });

  it('should recover the import id from an upload temp name', () => {
    expect(parseImportIdFromUploadTemporaryFilename(buildUploadTemporaryFilename(IMPORT_ID))).toBe(
      IMPORT_ID,
    );
  });

  it('should classify each producer namespace exclusively', () => {
    const upload = buildUploadTemporaryFilename(IMPORT_ID);
    const download = buildDownloadTemporaryFilename(IMPORT_ID);
    const archive = buildArchiveFilename(IMPORT_ID);

    expect([
      isUploadTemporaryFile(upload),
      isDownloadTemporaryFile(upload),
      isFinalArchiveFile(upload),
    ]).toEqual([true, false, false]);
    expect([
      isUploadTemporaryFile(download),
      isDownloadTemporaryFile(download),
      isFinalArchiveFile(download),
    ]).toEqual([false, true, false]);
    expect([
      isUploadTemporaryFile(archive),
      isDownloadTemporaryFile(archive),
      isFinalArchiveFile(archive),
    ]).toEqual([false, false, true]);
  });

  it('should not classify a legacy bare .tmp file as belonging to any producer', () => {
    expect(isUploadTemporaryFile(`${IMPORT_ID}.tmp`)).toBe(false);
    expect(isDownloadTemporaryFile(`${IMPORT_ID}.tmp`)).toBe(false);
    expect(isFinalArchiveFile(`${IMPORT_ID}.tmp`)).toBe(false);
  });

  it('should not classify a temp archive as a final archive', () => {
    expect(isFinalArchiveFile(`${IMPORT_ID}.json.gz.tmp`)).toBe(false);
  });
});
