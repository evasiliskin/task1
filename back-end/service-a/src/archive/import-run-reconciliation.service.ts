import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { type AppLogger } from '@task1/shared/logger/app-logger';
import { LoggerService } from '@task1/shared/logger/logger.service';
import { RequestContextService } from '@task1/shared/request-context/request-context.service';

import archiveConfig, { type ArchiveConfiguration } from '../config/archive.config.js';

import { ImportRunTracker } from './import-run-tracker.service.js';

/** Headroom over the download budget so a legitimately slow import is never reconciled away. */
const STALENESS_MULTIPLIER = 3;

const RECONCILED_LOG = 'Failed import runs abandoned in "started" by an interrupted process';
const RECONCILE_FAILED_LOG = 'Could not reconcile abandoned import runs';
const RECONCILE_REASON = 'Import run was interrupted before completing and has been reconciled';
const CLAIMS_EXPIRED_LOG = 'Expired claimed-but-never-started import reservations';
const CLAIMS_EXPIRE_FAILED_LOG = 'Could not expire stale import claims';

@Injectable()
export class ImportRunReconciliationService implements OnApplicationBootstrap {
  public constructor(
    private readonly importRunTracker: ImportRunTracker,
    @Inject(archiveConfig.KEY) private readonly archiveConfiguration: ArchiveConfiguration,
    private readonly requestContextService: RequestContextService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService.getLogger(ImportRunReconciliationService.name);
  }

  public async onApplicationBootstrap(): Promise<void> {
    await this.requestContextService.runAsRoot('import-run-reconciliation', () => this.reconcile());
  }

  private readonly logger: AppLogger;

  private async reconcile(): Promise<void> {
    const stalenessMs = this.archiveConfiguration.downloadTotalTimeoutMs * STALENESS_MULTIPLIER;
    const cutoff = new Date(Date.now() - stalenessMs);

    try {
      const reconciled = await this.importRunTracker.failStaleRuns(cutoff, RECONCILE_REASON);

      if (reconciled > 0) {
        this.logger.info({ count: reconciled, stalenessMs }, RECONCILED_LOG);
      }
    } catch (error) {
      // A reconciliation failure must not stop the service booting — the stale documents are a
      // reporting defect, not a correctness one, and the next start will retry.
      this.logger.warn({ stalenessMs }, RECONCILE_FAILED_LOG, error);
    }

    try {
      const expired = await this.importRunTracker.expireStaleClaims(cutoff);

      if (expired > 0) {
        this.logger.info({ count: expired, stalenessMs }, CLAIMS_EXPIRED_LOG);
      }
    } catch (error) {
      // Same rationale as above: a claim a client never retried is a hygiene gap, not a
      // correctness one (see expireStaleClaims's doc comment), so this must not block startup.
      this.logger.warn({ stalenessMs }, CLAIMS_EXPIRE_FAILED_LOG, error);
    }
  }
}
