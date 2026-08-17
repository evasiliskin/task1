import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';

import archiveConfig, { type ArchiveConfiguration } from '../config/archive.config.js';

import { InFlightImportRegistry } from './in-flight-import.registry.js';

const DRAINING_LOG = 'Waiting for in-flight imports before shutdown';
const DRAINED_LOG = 'In-flight imports finished; continuing shutdown';
const DRAIN_TIMED_OUT_LOG =
  'In-flight imports did not finish within the drain timeout; they will be redelivered';

@Injectable()
export class GracefulShutdownService implements OnModuleDestroy {
  public constructor(
    private readonly inFlightImports: InFlightImportRegistry,
    @Inject(archiveConfig.KEY) private readonly archiveConfiguration: ArchiveConfiguration,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(GracefulShutdownService.name);
  }

  public async onModuleDestroy(): Promise<void> {
    this.inFlightImports.beginShutdown();

    const pending = this.inFlightImports.size;
    const timeoutMs = this.archiveConfiguration.shutdownDrainTimeoutMs;

    if (pending > 0) {
      this.logger.info({ pending, timeoutMs }, DRAINING_LOG);
    }

    const drained = await this.inFlightImports.drain(timeoutMs);

    if (!drained) {
      this.logger.warn({ pending: this.inFlightImports.size, timeoutMs }, DRAIN_TIMED_OUT_LOG);

      return;
    }

    if (pending > 0) {
      this.logger.info({ pending }, DRAINED_LOG);
    }
  }

  private readonly logger: AppLogger;
}
