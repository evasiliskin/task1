import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { LoggerModule } from '@task1/shared/logger/http/logger.module';
import { diskStorage } from 'multer';

import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';

import { GetImportStatusController } from './get-import-status.controller.js';
import { TriggerImportController } from './trigger-import.controller.js';
import { UploadImportController } from './upload-import.controller.js';
import { buildTemporaryUploadFilename, isArchiveFilename } from './upload-storage.util.js';

@Module({
  imports: [
    LoggerModule,
    MulterModule.registerAsync({
      inject: [storageConfig.KEY, uploadConfig.KEY],
      useFactory: (
        storageConfiguration: ConfigType<typeof storageConfig>,
        uploadConfiguration: ConfigType<typeof uploadConfig>,
      ) => ({
        storage: diskStorage({
          destination: (_request, _file, callback) => {
            callback(null, storageConfiguration.dir);
          },
          filename: (_request, _file, callback) => {
            callback(null, buildTemporaryUploadFilename(randomUUID()));
          },
        }),
        fileFilter: (request, file, callback) => {
          if (isArchiveFilename(file.originalname)) {
            callback(null, true);

            return;
          }

          (request as { rejectedFilename?: string }).rejectedFilename = file.originalname;
          callback(null, false);
        },
        limits: { fileSize: uploadConfiguration.maxFileSizeBytes },
      }),
    }),
  ],
  controllers: [UploadImportController, TriggerImportController, GetImportStatusController],
})
export class ImportsModule {}
