export const PINO_LOGGER = Symbol('PINO_LOGGER');
export const PINO_DESTINATION = Symbol('PINO_DESTINATION');
export const LOG_CHANNEL = Symbol('LOG_CHANNEL');
/** Transport-neutral alias for `LoggerService`, so shared infra need not know http from rmq. */
export const LOGGER_FACTORY = Symbol('LOGGER_FACTORY');
