import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

import rabbitmqConfig from '../config/rabbitmq.config.js';
import storageConfig from '../config/storage.config.js';
import uploadConfig from '../config/upload.config.js';

import { GetImportStatusController } from './get-import-status.controller.js';
import { SERVICE_A_RMQ_CLIENT } from './rabbitmq-client.token.js';
import { TriggerImportController } from './trigger-import.controller.js';
import { UploadImportController } from './upload-import.controller.js';
import { buildTemporaryUploadFilename } from './upload-storage.util.js';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: SERVICE_A_RMQ_CLIENT,
        inject: [rabbitmqConfig.KEY],
        useFactory: (config: ConfigType<typeof rabbitmqConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.url],
            queue: config.serviceAQueue,
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
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
        limits: { fileSize: uploadConfiguration.maxFileSizeBytes },
      }),
    }),
  ],
  controllers: [UploadImportController, TriggerImportController, GetImportStatusController],
})
export class ImportsModule {}
