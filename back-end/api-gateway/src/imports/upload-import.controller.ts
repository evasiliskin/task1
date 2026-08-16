import { rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { type ClientProxy } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RPC_PATTERNS } from '@task1/shared/messaging/rpc-patterns.const';
import { ContextPropagatingClient } from '@task1/shared/request-context/rmq/context-propagating.client';
import { type Request } from 'express';

import storageConfig, { type StorageConfiguration } from '../config/storage.config.js';
import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { EmptyRequestSchema } from '../contract/schemas/empty.schema.js';
import { publishImportMessage } from '../rmq/publish-import-message.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import {
  ArchiveUploadError,
  MissingUploadFileError,
  UnsupportedArchiveFormatError,
} from './errors.js';
import { UploadImportResponseSchema } from './schemas/upload-import-response.schema.js';
import {
  buildFinalArchiveFilename,
  isGzipFile,
  parseImportIdFromTemporaryFilename,
} from './upload-storage.util.js';

const UNLINK_REJECTED_UPLOAD_FAILED_LOG = 'Failed to remove an upload rejected as non-gzip content';

@ApiTags('imports')
@Controller('imports')
export class UploadImportController {
  public constructor(
    @Inject(SERVICE_A_IMPORTS_RMQ_CLIENT) private readonly serviceAImportsClient: ClientProxy,
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
    private readonly propagatingClient: ContextPropagatingClient,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(UploadImportController.name);
  }

  // Tighter than the global default (100/min) — literal here must be kept in
  // sync with throttle.config.ts's uploadLimit/ttlMs defaults; @Throttle's
  // metadata is a compile-time decorator argument, not something that can
  // read injected config at request time.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @Contract({ request: EmptyRequestSchema, response: UploadImportResponseSchema })
  @ApiSingleResponse(UploadImportResponseSchema, { status: HttpStatus.CREATED })
  public async upload(
    @Req() request: Request & { rejectedFilename?: string },
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ importId: string }> {
    if (request.rejectedFilename !== undefined) {
      throw new UnsupportedArchiveFormatError(request.rejectedFilename);
    }

    if (file === undefined) {
      throw new MissingUploadFileError();
    }

    if (!(await isGzipFile(file.path))) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file.path is the temp path multer just wrote inside the configured storage directory.
      await unlink(file.path).catch((error: unknown) => {
        this.logger.warn({ path: file.path }, UNLINK_REJECTED_UPLOAD_FAILED_LOG, error);
      });

      throw new UnsupportedArchiveFormatError(file.originalname);
    }

    const importId = parseImportIdFromTemporaryFilename(file.filename);
    const finalPath = join(this.storageConfiguration.dir, buildFinalArchiveFilename(importId));

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

    await publishImportMessage({
      propagatingClient: this.propagatingClient,
      client: this.serviceAImportsClient,
      pattern: RPC_PATTERNS.ARCHIVE_PROCESS_UPLOAD,
      payload: { importId, filePath: finalPath },
    });

    return { importId };
  }

  private readonly logger: AppLogger;
}
