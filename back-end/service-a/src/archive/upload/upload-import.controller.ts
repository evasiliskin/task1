import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { ArchiveProcessingService } from './archive-processing.service.js';
import { uploadImportMessageSchema } from './upload-import-message.schema.js';

@Controller()
export class UploadImportController {
  public constructor(private readonly archiveProcessingService: ArchiveProcessingService) {}

  @EventPattern('archive.process.upload')
  public async handleUpload(@Payload() payload: unknown): Promise<void> {
    const { importId, filePath } = uploadImportMessageSchema.parse(payload);

    await this.archiveProcessingService.process(filePath, importId);
  }
}
