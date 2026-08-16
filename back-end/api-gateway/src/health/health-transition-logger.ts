import { Injectable } from '@nestjs/common';
import { type HealthCheckResult } from '@nestjs/terminus';
import { type AppLogger } from '@task1/shared/logger/app-logger';

export const HEALTH_CHECK_FAILED_LOG = 'health check failed';
export const HEALTH_CHECK_RECOVERED_LOG = 'health check recovered';

/**
 * Logs the moment a dependency changes state, not the state itself.
 *
 * Health endpoints are polled continuously, so logging the current state every time turns one
 * outage into hundreds of identical lines. The transition is the event; the state is already in the
 * response body.
 *
 * Its own collaborator rather than a method on HealthCheckService: this set is the only mutable
 * state in the health path and has a lifetime of its own.
 */
@Injectable()
export class HealthTransitionLogger {
  public constructor(private readonly logger: AppLogger) {}

  public record(details: HealthCheckResult['details'], responseTimeMs: number): void {
    // correlationId and requestId are stamped on every line by pino's mixin — repeating them here
    // would model a pattern that hides the fact that context is automatic. `dependency`, not
    // `service`: `service` is a pino `base` binding naming *this* process.
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
