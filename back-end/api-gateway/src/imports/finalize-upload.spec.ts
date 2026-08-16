import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArchiveUploadError, UnsupportedArchiveFormatError } from './errors.js';
import { finalizeUpload } from './finalize-upload.js';

// Only `unlink` is wrapped so the "rename" happy-path tests below still exercise the real
// filesystem; this lets the "unlink itself fails" test below inject a failure deterministically.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>();

  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const IMPORT_ID = '11111111-1111-4111-8111-111111111111';
const GZIP_HEADER = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);

describe('finalizeUpload', () => {
  let storageDirectory: string;

  beforeEach(() => {
    storageDirectory = mkdtempSync(join(tmpdir(), 'finalize-upload-spec-'));
    vi.mocked(unlink).mockClear();
  });

  afterEach(() => {
    rmSync(storageDirectory, { recursive: true, force: true });
  });

  function writeTempUpload(contents: Buffer): Express.Multer.File {
    const filename = `${IMPORT_ID}.upload.tmp`;
    const path = join(storageDirectory, filename);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is inside a per-test mkdtemp() sandbox.
    writeFileSync(path, contents);

    return { filename, path, originalname: 'archive.json.gz' } as Express.Multer.File;
  }

  it('should rename a gzip upload to its final archive path', async () => {
    const file = writeTempUpload(GZIP_HEADER);

    const result = await finalizeUpload({
      file,
      storageDirectory,
      onUnlinkFailed: vi.fn(),
    });

    expect(result).toEqual({
      importId: IMPORT_ID,
      finalPath: join(storageDirectory, `${IMPORT_ID}.json.gz`),
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- result.finalPath is derived from this test's own mkdtemp() sandbox and a server-generated UUID, never external input.
    expect(existsSync(result.finalPath)).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
    expect(existsSync(file.path)).toBe(false);
  });

  it('should reject and delete a file whose content is not gzip', async () => {
    const file = writeTempUpload(Buffer.from('plain text'));

    await expect(
      finalizeUpload({ file, storageDirectory, onUnlinkFailed: vi.fn() }),
    ).rejects.toBeInstanceOf(UnsupportedArchiveFormatError);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- file.path is this test's own mkdtemp() sandbox fixture, never external input.
    expect(existsSync(file.path)).toBe(false);
  });

  it('should reject with the raw fs error when the temp file is already gone', async () => {
    const file = writeTempUpload(Buffer.from('plain text'));
    const onUnlinkFailed = vi.fn();

    // Remove the file first: isGzipFile's own `open()` throws ENOENT before finalizeUpload ever
    // reaches the unlink call, so onUnlinkFailed is not invoked in this path (see the unlink
    // -itself-fails test below for that branch).
    rmSync(file.path);

    await expect(finalizeUpload({ file, storageDirectory, onUnlinkFailed })).rejects.toBeInstanceOf(
      Error,
    );
    expect(onUnlinkFailed).not.toHaveBeenCalled();
  });

  it('should report an unlink failure through the callback when unlink itself fails', async () => {
    const file = writeTempUpload(Buffer.from('plain text'));
    const onUnlinkFailed = vi.fn();
    const unlinkError = Object.assign(new Error('EPERM: simulated unlink failure'), {
      code: 'EPERM',
    });

    vi.mocked(unlink).mockRejectedValueOnce(unlinkError);

    await expect(finalizeUpload({ file, storageDirectory, onUnlinkFailed })).rejects.toBeInstanceOf(
      UnsupportedArchiveFormatError,
    );
    expect(onUnlinkFailed).toHaveBeenCalledWith(file.path, unlinkError);
  });

  it('should wrap a rename failure as ArchiveUploadError', async () => {
    const file = writeTempUpload(GZIP_HEADER);

    await expect(
      finalizeUpload({
        file,
        storageDirectory: join(storageDirectory, 'does', 'not', 'exist'),
        onUnlinkFailed: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ArchiveUploadError);
  });
});
