import { Inject, Injectable } from '@nestjs/common';

import archiveConfig, { type ArchiveConfiguration } from '../../config/archive.config.js';
import storageConfig, { type StorageConfiguration } from '../../config/storage.config.js';

import { downloadArchive, type IDownloadArchiveResult } from './download-archive.js';
import { type HttpGetFunction } from './fetch-archive-stream.js';

@Injectable()
export class ArchiveDownloadService {
  public constructor(
    @Inject(archiveConfig.KEY) private readonly archiveConfiguration: ArchiveConfiguration,
    @Inject(storageConfig.KEY) private readonly storageConfiguration: StorageConfiguration,
  ) {}

  public download(dateHour: string, httpGet?: HttpGetFunction): Promise<IDownloadArchiveResult> {
    return downloadArchive(
      dateHour,
      {
        baseUrl: this.archiveConfiguration.baseUrl,
        storageDirectory: this.storageConfiguration.dir,
        timeoutMs: this.archiveConfiguration.downloadTimeoutMs,
      },
      httpGet,
    );
  }
}
