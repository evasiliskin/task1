import { Injectable } from '@nestjs/common';
import { type HealthCheckResult } from '@nestjs/terminus';
import { type AppLogger } from '@task1/shared/logger/app-logger';

export const HEALTH_CHECK_FAILED_LOG = 'health check failed';
export const HEALTH_CHECK_RECOVERED_LOG = 'health check recovered';

@Injectable()
export class HealthTransitionLogger {
  public constructor(private readonly logger: AppLogger) {}

  public record(details: HealthCheckResult['details'], responseTimeMs: number): void {
    Object.entries(details).forEach(([dependency, detail]) => {
      const isDown = detail.status === 'down';
      const wasDown = this.downDependencies.has(dependency);

      if (isDown && !wasDown) {
        this.downDependencies.add(dependency);
        this.logger.error(
          { dependency, errorMessage: detail.message, responseTimeMs },
          HEALTH_CHECK_FAILED_LOG,
        );

        return;
      }

      if (!isDown && wasDown) {
        this.downDependencies.delete(dependency);
        this.logger.info({ dependency, responseTimeMs }, HEALTH_CHECK_RECOVERED_LOG);
      }
    });
  }

  private readonly downDependencies = new Set<string>();
}
