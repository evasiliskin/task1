import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

import { ImportRunTracker } from './import-run-tracker.service.js';
import { type IImportRunDocument } from './import-run.types.js';
import { importStatusMessageSchema } from './import-status-message.schema.js';

@Controller()
export class ImportStatusController {
  public constructor(private readonly importRunTracker: ImportRunTracker) {}

  @MessagePattern('imports.status.get')
  public async handleGetStatus(@Payload() payload: unknown): Promise<IImportRunDocument | null> {
    const { importId } = importStatusMessageSchema.parse(payload);

    return await this.importRunTracker.findByImportId(importId);
  }
}
