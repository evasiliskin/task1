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

import rabbitmqConfig, { type RabbitmqConfiguration } from '../config/rabbitmq.config.js';
import storageConfig, { type StorageConfiguration } from '../config/storage.config.js';
import throttleConfig from '../config/throttle.config.js';
import { ApiSingleResponse } from '../contract/decorators/api-envelope-response.decorator.js';
import { Contract } from '../contract/decorators/contract.decorator.js';
import { EmptyRequestSchema } from '../contract/schemas/empty.schema.js';
import { publishImportMessage } from '../rmq/publish-import-message.js';
import { SERVICE_A_IMPORTS_RMQ_CLIENT } from '../rmq/rmq-client.tokens.js';

import { MissingUploadFileError, UnsupportedArchiveFormatError } from './errors.js';
import { finalizeUpload } from './finalize-upload.js';
import { UploadImportResponseSchema } from './schemas/upload-import-response.schema.js';

const UNLINK_REJECTED_UPLOAD_FAILED_LOG = 'Failed to remove an upload rejected as non-gzip content';

@ApiTags('imports')
@Controller('imports')
export class UploadImportController {
  public constructor(
    @Inject(SERVICE_A_IMPORTS_RMQ_CLIENT) private readonly serviceAImportsClient: ClientProxy,
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
    @Inject(rabbitmqConfig.KEY) private readonly rabbitmqConfiguration: RabbitmqConfiguration,
    private readonly propagatingClient: ContextPropagatingClient,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(UploadImportController.name);
  }

  @Throttle({
    default: {
      limit: () => throttleConfig().uploadLimit,
      ttl: () => throttleConfig().ttlMs,
    },
  })
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

    const { importId, finalPath } = await finalizeUpload({
      file,
      storageDirectory: this.storageConfiguration.dir,
      onUnlinkFailed: (path, error) => {
        this.logger.warn({ path }, UNLINK_REJECTED_UPLOAD_FAILED_LOG, error);
      },
    });

    await publishImportMessage({
      propagatingClient: this.propagatingClient,
      client: this.serviceAImportsClient,
      pattern: RPC_PATTERNS.ARCHIVE_PROCESS_UPLOAD,
      payload: { importId, filePath: finalPath },
      timeoutMs: this.rabbitmqConfiguration.rpcTimeoutMs,
    });

    return { importId };
  }

  private readonly logger: AppLogger;
}
