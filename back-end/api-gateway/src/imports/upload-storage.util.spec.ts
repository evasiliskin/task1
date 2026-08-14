import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  buildFinalArchiveFilename,
  buildTemporaryUploadFilename,
  isArchiveFilename,
  isGzipFile,
  parseImportIdFromTemporaryFilename,
  TEMP_UPLOAD_FILE_SUFFIX,
} from './upload-storage.util.js';

describe('isArchiveFilename', () => {
  it('should return true, when the filename ends with .json.gz', () => {
    expect(isArchiveFilename('2026-08-11-0.json.gz')).toBe(true);
  });

  it('should return true, when the filename extension has mixed case', () => {
    expect(isArchiveFilename('archive.JSON.GZ')).toBe(true);
  });

  it('should return false, when the filename does not end with .json.gz', () => {
    expect(isArchiveFilename('archive.txt')).toBe(false);
  });

  it('should return false, when the filename has no extension', () => {
    expect(isArchiveFilename('archive')).toBe(false);
  });
});

describe('buildTemporaryUploadFilename', () => {
  it('should append the temp suffix to the importId, when called', () => {
    expect(buildTemporaryUploadFilename('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(
      `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11${TEMP_UPLOAD_FILE_SUFFIX}`,
    );
  });
});

describe('parseImportIdFromTemporaryFilename', () => {
  it('should strip the temp suffix, when the filename has one', () => {
    expect(parseImportIdFromTemporaryFilename('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.tmp')).toBe(
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    );
  });
});

describe('buildFinalArchiveFilename', () => {
  it('should append .json.gz to the importId, when called', () => {
    expect(buildFinalArchiveFilename('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.json.gz',
    );
  });
});

describe('isGzipFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'upload-storage-util-spec-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('should return true, when the file starts with the gzip magic bytes', () => {
    const filePath = join(directory, 'archive.json.gz');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is built from a test-owned temp directory, not external input.
    writeFileSync(filePath, gzipSync(Buffer.from('{"id":"1"}\n')));

    return expect(isGzipFile(filePath)).resolves.toBe(true);
  });

  it('should return false, when the file does not start with the gzip magic bytes', () => {
    const filePath = join(directory, 'archive.json.gz');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is built from a test-owned temp directory, not external input.
    writeFileSync(filePath, Buffer.from('not gzip at all'));

    return expect(isGzipFile(filePath)).resolves.toBe(false);
  });

  it('should return false, when the file is shorter than 2 bytes', () => {
    const filePath = join(directory, 'archive.json.gz');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- filePath is built from a test-owned temp directory, not external input.
    writeFileSync(filePath, Buffer.from([0x1f]));

    return expect(isGzipFile(filePath)).resolves.toBe(false);
  });
});
