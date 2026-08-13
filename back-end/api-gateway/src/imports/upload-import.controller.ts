import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

import storageConfig from '../config/storage.config.js';

import { UploadImportResponseDto } from './dto/upload-import-response.dto.js';
import {
  ArchiveUploadError,
  MissingUploadFileError,
  UnsupportedArchiveFormatError,
} from './errors.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import {
  buildFinalArchiveFilename,
  isArchiveFilename,
  parseImportIdFromTemporaryFilename,
} from './upload-storage.util.js';

const ARCHIVE_PROCESS_UPLOAD_PATTERN = 'archive.process.upload';

@ApiTags('imports')
@Controller('imports')
export class UploadImportController {
  public constructor(@Inject(SERVICE_A_RMQ_CLIENT) private readonly serviceAClient: ClientProxy) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiCreatedResponse({ type: UploadImportResponseDto })
  public async upload(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadImportResponseDto> {
    if (file === undefined) {
      throw new MissingUploadFileError();
    }

    if (!isArchiveFilename(file.originalname)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file.path is the temp path Multer just wrote inside the configured storage directory, not raw external input.
      await unlink(file.path).catch(() => undefined);

      throw new UnsupportedArchiveFormatError(file.originalname);
    }

    const importId = parseImportIdFromTemporaryFilename(file.filename);
    const finalPath = join(storageConfig().dir, buildFinalArchiveFilename(importId));

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- both paths are derived from the configured storage directory and a server-generated UUID, never raw external input.
      await rename(file.path, finalPath);
    } catch (error) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- see justification above.
      await unlink(file.path).catch(() => undefined);

      const cause = error instanceof Error ? error : undefined;

      throw new ArchiveUploadError(
        `Failed to finalize uploaded archive: ${error instanceof Error ? error.message : String(error)}`,
        importId,
        cause,
      );
    }

    this.serviceAClient.emit(ARCHIVE_PROCESS_UPLOAD_PATTERN, { importId, filePath: finalPath });

    return new UploadImportResponseDto(importId);
  }
}
