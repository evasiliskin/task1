import { type AppLogger } from './app-logger.js';
import { type LogChannel } from './types.js';

/**
 * The transport-neutral view of `LoggerService`. Shared infrastructure depends on this rather than
 * the concrete class, so a service in `libs/shared` is not welded to one transport's DI graph.
 *
 * Deliberately its own file, not part of `types.ts`: `app-logger.ts` imports from `types.ts`, so
 * putting an `AppLogger` reference there would create an import cycle that `isolatedModules`
 * preserves at runtime.
 */
export interface ILoggerFactory {
  getLogger(source: string, channel?: LogChannel): AppLogger;
}
