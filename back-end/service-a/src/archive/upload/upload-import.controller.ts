import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import { ImportOrchestrationService } from '../import-orchestration.service.js';

import { uploadImportMessageSchema } from './upload-import-message.schema.js';

@Controller()
export class UploadImportController {
  public constructor(
    private readonly importOrchestrationService: ImportOrchestrationService,
    private readonly requestContextService: RequestContextService,
  ) {}

  @EventPattern('archive.process.upload')
  public async handleUpload(@Payload() payload: unknown): Promise<void> {
    const { importId, filePath } = uploadImportMessageSchema.parse(payload);
    const { correlationId } = this.requestContextService.requireContext();

    await this.importOrchestrationService.importUpload(filePath, importId, correlationId);
  }
}
